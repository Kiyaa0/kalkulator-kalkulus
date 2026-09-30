import base64
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import functools
import io
import logging
import os
import re
import threading
import time

from flask import Flask, g, jsonify, render_template, request
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import sympy as sp
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

# =============================================================================
# SECTION 1: FLASK INITIALIZATION & CONFIGURATION
# =============================================================================
app = Flask(__name__)

try:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
except ImportError:
    pass

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024  # 16 KB max payload
app.config['JSON_AS_ASCII'] = False
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32).hex()
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Base Math Symbols & Dictionaries
x = sp.Symbol('x')
y = sp.Symbol('y')
VARS = {'x': x, 'y': y}

TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)
LOCAL_DICT = {
    'x': x, 'y': y,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'log': sp.log, 'ln': sp.log,
    'log10': lambda v: sp.log(v, 10),
    'exp': sp.exp, 'sqrt': sp.sqrt,
    'Abs': sp.Abs, 'pi': sp.pi,
    'E': sp.E,
}

# =============================================================================
# SECTION 2: SECURITY, SANITIZATION & RATE LIMITING
# =============================================================================
MAX_FUNCTION_LENGTH = 200
MAX_ORDE = 10
SYMPY_TIMEOUT = 5
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sympy")

_BLOCKED_KEYWORDS = [
    '__', 'import', 'exec', 'eval', 'open', 'os.', 'sys.',
    'subprocess', 'compile', 'globals', 'locals', 'getattr', 'setattr'
]
_BLOCKED_CHARS_RE = re.compile(r'[;`$\\\'"#@!&?<>:~]')


def validate_fungsi(expr_str):
    """Memvalidasi ekspresi matematika dari user sebelum diproses SymPy."""
    if not isinstance(expr_str, str):
        return False, "Fungsi harus berupa string"
    s = expr_str.strip()
    if not s:
        return False, "Fungsi tidak boleh kosong"
    if len(s) > MAX_FUNCTION_LENGTH:
        return False, f"Fungsi terlalu panjang (maks {MAX_FUNCTION_LENGTH} karakter, kamu {len(s)})"
    low = s.lower()
    for kw in _BLOCKED_KEYWORDS:
        if kw in low:
            return False, f"Kata kunci tidak diizinkan: {kw}"
    if _BLOCKED_CHARS_RE.search(s):
        return False, "Karakter tidak diizinkan terdeteksi ( ; ` $ \" ' # dll )"
    if len(s) > 50 and len(set(s)) < 3:
        return False, "Fungsi terlihat spam / tidak valid"
    return True, ""


# In-Memory Sliding Window Rate Limiter
_lock = threading.Lock()
_request_logs = defaultdict(lambda: defaultdict(deque))
_last_cleanup = time.time()
CLEANUP_INTERVAL = 300


def _get_client_ip():
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    xri = request.headers.get('X-Real-IP', '')
    if xri:
        return xri.strip()
    return request.remote_addr or '127.0.0.1'


def _is_rate_limited(ip, bucket, limit, window):
    now = time.time()
    dq = _request_logs[ip][bucket]
    while dq and dq[0] <= now - window:
        dq.popleft()
    if len(dq) >= limit:
        retry_after = dq[0] + window - now
        return True, max(1, int(retry_after) + 1)
    dq.append(now)
    return False, 0


def _maybe_cleanup():
    global _last_cleanup
    now = time.time()
    if now - _last_cleanup < CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    cutoff = now - 3600
    to_delete = []
    for ip, buckets in list(_request_logs.items()):
        empty = True
        for bucket, dq in list(buckets.items()):
            while dq and dq[0] < cutoff:
                dq.popleft()
            if dq:
                empty = False
            else:
                buckets.pop(bucket, None)
        if empty or not buckets:
            to_delete.append(ip)
    for ip in to_delete:
        _request_logs.pop(ip, None)


def rate_limit(api_limit=30, api_window=60, burst_limit=20, burst_window=10, global_limit=60, global_window=60):
    def decorator(f):
        @functools.wraps(f)
        def wrapped(*args, **kwargs):
            ip = _get_client_ip()
            is_api = request.path.startswith('/api/')
            bucket_global = f"global_{global_limit}_{global_window}"
            bucket_burst = f"burst_{burst_limit}_{burst_window}"
            bucket_api = f"api_{api_limit}_{api_window}"
            with _lock:
                _maybe_cleanup()
                limited, retry = _is_rate_limited(ip, bucket_global, global_limit, global_window)
                if limited:
                    logger.warning(f"Rate limit GLOBAL hit ip={ip} path={request.path}")
                    resp = jsonify({"sukses": False, "error": f"Terlalu banyak request. Coba lagi dalam {retry} detik.", "retry_after": retry})
                    resp.status_code = 429
                    resp.headers["Retry-After"] = str(retry)
                    return resp

                limited, retry = _is_rate_limited(ip, bucket_burst, burst_limit, burst_window)
                if limited:
                    logger.warning(f"Rate limit BURST hit ip={ip} path={request.path}")
                    resp = jsonify({"sukses": False, "error": f"Terlalu cepat. Tunggu {retry} detik.", "retry_after": retry})
                    resp.status_code = 429
                    resp.headers["Retry-After"] = str(retry)
                    return resp

                if is_api:
                    limited, retry = _is_rate_limited(ip, bucket_api, api_limit, api_window)
                    if limited:
                        logger.warning(f"Rate limit API hit ip={ip} path={request.path}")
                        resp = jsonify({"sukses": False, "error": f"Limit API tercapai (maks {api_limit} req / {api_window}s). Coba lagi dalam {retry} detik.", "retry_after": retry})
                        resp.status_code = 429
                        resp.headers["Retry-After"] = str(retry)
                        return resp

            g.rate_limit_ip = ip
            return f(*args, **kwargs)
        return wrapped
    return decorator


def run_with_timeout(func, *args, timeout=SYMPY_TIMEOUT, **kwargs):
    """Menjalankan kalkulasi berat pada worker thread dengan batasan timeout."""
    future = _executor.submit(func, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        raise TimeoutError(f"Kalkulasi terlalu lama / terlalu kompleks (timeout {timeout}s). Coba sederhanakan fungsi.")


# =============================================================================
# SECTION 3: SYMPY MATH & CALCULUS ENGINE
# =============================================================================
def _detect_var(expr, requested=None):
    if requested in VARS:
        return VARS[requested]
    if expr is not None:
        syms = expr.free_symbols
        if y in syms and x not in syms:
            return y
        if x in syms and y not in syms:
            return x
        if x in syms and y in syms:
            return x
    return x


def _get_requested_var(data):
    if not isinstance(data, dict):
        return None
    for k in ('variabel', 'variable', 'var', 'symbol'):
        v = data.get(k)
        if isinstance(v, str) and v.strip().lower() in VARS:
            return v.strip().lower()
    return None


def parse_function(func_str):
    """Membersihkan format ekspresi dan mengurai ke bentuk objek SymPy."""
    try:
        s = func_str.replace('^', '**')
        s = re.sub(r'\be\b', 'E', s)
        s = re.sub(r'(\d)([a-zA-Z])', r'\1*\2', s)
        s = re.sub(r'([xy])\(', r'\1*(', s)
        s = re.sub(r'\)\(', r')*(', s)
        s = re.sub(r'\)([a-zA-Z])', r')*\1', s)
        s = re.sub(r'(\d)\(', r'\1*(', s)
        return parse_expr(s, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
    except Exception:
        return None


def sympy_to_numpy(expr, var=None):
    if var is None:
        var = _detect_var(expr)
    return sp.lambdify(var, expr, 'numpy')


def simplify_integral(expr):
    candidates = [
        expr,
        sp.factor(expr),
        sp.simplify(expr),
        sp.radsimp(expr),
        sp.powsimp(expr, deep=True),
    ]
    return min(candidates, key=lambda e: len(str(e)))


# =============================================================================
# SECTION 4: PLOTTING ENGINE (MATPLOTLIB)
# =============================================================================
def fig_to_png_svg(fig):
    """Menghasilkan representasi PNG Base64 dan string SVG dari figur matplotlib."""
    buf_png = io.BytesIO()
    fig.savefig(buf_png, format='png', dpi=120, bbox_inches='tight', facecolor=fig.get_facecolor())
    buf_svg = io.BytesIO()
    fig.savefig(buf_svg, format='svg', bbox_inches='tight', facecolor=fig.get_facecolor())
    plt.close(fig)
    png_b64 = base64.b64encode(buf_png.getvalue()).decode('utf-8')
    svg_str = buf_svg.getvalue().decode('utf-8')
    return png_b64, svg_str


def _new_fig_ax():
    fig, ax = plt.subplots(figsize=(8, 4.5))
    fig.set_facecolor('#1e293b')
    ax.set_facecolor('#0f172a')
    return fig, ax


def _style_ax(ax, title=None, xlabel=None, ylabel=None):
    if title:
        ax.set_title(title, color='#e2e8f0', fontsize=11, pad=10)
    if xlabel:
        ax.set_xlabel(xlabel, color='#94a3b8')
    if ylabel:
        ax.set_ylabel(ylabel, color='#94a3b8')
    ax.grid(True, which='major', color='#475569', alpha=0.55, linestyle='--', linewidth=0.9, zorder=0)
    ax.minorticks_on()
    ax.grid(True, which='minor', color='#334155', alpha=0.28, linestyle=':', linewidth=0.7, zorder=0)
    ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#e2e8f0', fontsize=9, framealpha=0.9)
    ax.tick_params(colors='#94a3b8', labelsize=9, direction='in', length=4)
    for spine in ax.spines.values():
        spine.set_color('#475569')
        spine.set_linewidth(1.0)


def _apply_ylim(ax, *y_arrays, padding=0.12, fallback=(-5, 5), abs_max=1e6):
    all_vals = []
    for arr in y_arrays:
        if arr is not None:
            finite = arr[np.isfinite(arr)]
            if len(finite):
                finite = finite[np.abs(finite) < abs_max]
                all_vals.append(finite)
    if not all_vals:
        ax.set_ylim(*fallback)
        return
    combined = np.concatenate(all_vals)
    if len(combined) == 0:
        ax.set_ylim(*fallback)
        return
    min_y, max_y = float(combined.min()), float(combined.max())
    rng = max_y - min_y if max_y != min_y else 1.0
    ax.set_ylim(min_y - rng * padding, max_y + rng * padding)


def plot_derivative(f_expr, derivative_expr, func_str, order, point_val, evaluated, var=None):
    if var is None:
        var = _detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        f_numpy = sympy_to_numpy(f_expr, var)
        d_numpy = sympy_to_numpy(derivative_expr, var)
        x_min = (point_val - 3) if point_val is not None else -5
        x_max = (point_val + 3) if point_val is not None else 5
        x_vals = np.linspace(x_min, x_max, 400)
        y_f = f_numpy(x_vals)
        y_d = d_numpy(x_vals)

        prime_label = "f" + "'" * order + f"({var_name})"
        ax.plot(x_vals[np.isfinite(y_f)], y_f[np.isfinite(y_f)],
                label=f'f({var_name}) = {func_str}',
                color='#38bdf8', linewidth=2.2, zorder=3)
        ax.plot(x_vals[np.isfinite(y_d)], y_d[np.isfinite(y_d)],
                label=prime_label,
                color='#f87171', linestyle='--', linewidth=2.0,
                dashes=(6, 3), zorder=3)

        if point_val is not None and evaluated is not None and evaluated.is_finite and evaluated.is_real:
            ax.plot(point_val, float(evaluated), 'o',
                    color='#22c55e', markersize=9,
                    markeredgecolor='white', markeredgewidth=1.2,
                    label=f"f'({point_val}) = {float(evaluated):.4f}", zorder=4)
            ax.axvline(point_val, color='#475569', linestyle=':', linewidth=0.9, alpha=0.6, zorder=2)
            ax.axhline(float(evaluated), color='#475569', linestyle=':', linewidth=0.8, alpha=0.5, zorder=2)

        _apply_ylim(ax, y_f, y_d)
        _style_ax(ax, title=f'Turunan ke-{order} terhadap {var_name}', xlabel=var_name, ylabel='y')
    except Exception:
        pass
    return fig_to_png_svg(fig)


def plot_integral(f_expr, indef_expr, func_str, lb, ub, def_val, var=None):
    if var is None:
        var = _detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        f_numpy = sympy_to_numpy(f_expr, var)
        ind_numpy = sympy_to_numpy(indef_expr, var)

        lb_f, ub_f = float(lb), float(ub)
        is_indefinite = isinstance(def_val, sp.Integral)

        if is_indefinite:
            x_plot = np.linspace(-5, 5, 400)
        else:
            margin = max((ub_f - lb_f) * 0.4, 1.5)
            x_plot = np.linspace(lb_f - margin, ub_f + margin, 400)

        y_f = f_numpy(x_plot)
        y_ind = ind_numpy(x_plot)

        ax.plot(x_plot[np.isfinite(y_f)], y_f[np.isfinite(y_f)],
                label=f'f({var_name}) = {func_str}',
                color='#38bdf8', linewidth=2.2, zorder=3)
        ax.plot(x_plot[np.isfinite(y_ind)], y_ind[np.isfinite(y_ind)],
                label='F(x) + C',
                color='#4ade80', linestyle='--', linewidth=2.0,
                dashes=(6, 3), zorder=3)

        if not is_indefinite:
            x_fill = np.linspace(lb_f, ub_f, 200)
            y_fill = f_numpy(x_fill)
            try:
                area = float(def_val.evalf()) if hasattr(def_val, 'evalf') else float(def_val)
                label_area = f'Area = {area:.4f}'
            except Exception:
                label_area = 'Area'
            ax.fill_between(x_fill, y_fill, color='#a855f7', alpha=0.30, label=label_area, zorder=2)
            ax.axvline(lb_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)
            ax.axvline(ub_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)

        _apply_ylim(ax, y_f, y_ind)
        _style_ax(ax, title='Grafik Fungsi dan Integral', xlabel=var_name, ylabel='y')
    except Exception:
        pass
    return fig_to_png_svg(fig)


def plot_limit(f_expr, func_str, point_sym, limit_val, direction, var=None):
    if var is None:
        var = _detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        f_numpy = sympy_to_numpy(f_expr, var)
        pt = float(point_sym)
        x_vals = np.linspace(pt - 2, pt + 2, 400)
        y_vals = f_numpy(x_vals)
        finite = np.isfinite(y_vals)

        ax.plot(x_vals[finite], y_vals[finite],
                label=f'f({var_name}) = {func_str}',
                color='#38bdf8', linewidth=2.2, zorder=3)

        if limit_val.is_finite:
            lv = float(limit_val)
            ax.plot(pt, lv, 'o',
                    color='#ef4444', markersize=9,
                    markeredgecolor='white', markeredgewidth=1.2,
                    label=f'Limit = {sp.latex(limit_val)}', zorder=4)
            ax.axvline(pt, color='#475569', linestyle=':', linewidth=1.0, alpha=0.7, zorder=2)
            ax.axhline(lv, color='#475569', linestyle=':', linewidth=0.8, alpha=0.5, zorder=2)

        _apply_ylim(ax, y_vals)
        _style_ax(ax, title=f'Limit di {var_name} \u2192 {point_sym}', xlabel=var_name, ylabel=f'f({var_name})')
    except Exception:
        pass
    return fig_to_png_svg(fig)


# =============================================================================
# SECTION 5: MATRIX ENGINE (MODULAR OPERATIONS & STEP GENERATOR)
# =============================================================================
def _is_negative(val):
    """Cek apakah nilai negatif secara aman tanpa TypeError pada ekspresi simbolik."""
    try:
        if hasattr(val, 'is_negative') and val.is_negative is not None:
            return bool(val.is_negative)
        return bool(val < 0)
    except Exception:
        return False


def _parse_matrix_cell(val):
    """Mengurai sel matriks menjadi objek numerik/pecahan SymPy."""
    if val is None:
        return sp.Integer(0)
    s = str(val).strip().replace(',', '.')
    if not s:
        return sp.Integer(0)
    if len(s) > 35:
        raise ValueError('Nilai sel terlalu panjang (maks. 35 karakter)')
    low = s.lower()
    for kw in _BLOCKED_KEYWORDS:
        if kw in low:
            raise ValueError(f'Karakter/kata kunci tidak diizinkan: {kw}')
    if '/' in s:
        parts = s.split('/')
        if len(parts) == 2:
            try:
                num = sp.Integer(parts[0].strip())
                den = sp.Integer(parts[1].strip())
                if den == 0:
                    raise ValueError('Pecahan tidak valid: pembagian dengan nol')
                return sp.Rational(num, den)
            except Exception:
                pass
    try:
        return parse_expr(s, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
    except Exception as e:
        raise ValueError(f'Nilai sel "{s}" tidak valid: {str(e)}')


def _matrix_from_json(grid, name='Matriks'):
    """Mengonversi 2D list JSON ke matriks SymPy dengan validasi batas ordo."""
    if not grid or not isinstance(grid, list):
        raise ValueError(f'Data {name} tidak boleh kosong')
    num_rows = len(grid)
    if num_rows < 1 or num_rows > 8:
        raise ValueError(f'Jumlah baris {name} harus antara 1 dan 8')
    if not isinstance(grid[0], list):
        raise ValueError(f'Format baris {name} tidak valid')
    num_cols = len(grid[0])
    if num_cols < 1 or num_cols > 8:
        raise ValueError(f'Jumlah kolom {name} harus antara 1 dan 8')

    rows = []
    for r_idx, r in enumerate(grid):
        if not isinstance(r, list) or len(r) != num_cols:
            raise ValueError(f'Baris ke-{r_idx+1} pada {name} memiliki jumlah kolom yang tidak konsisten')
        rows.append([_parse_matrix_cell(c) for c in r])
    return sp.Matrix(rows)


def _matrix_to_list(M):
    """Mengonversi matriks SymPy ke list 2D string untuk dikirim via JSON."""
    r, c = M.shape
    return [[str(M[i, j]) for j in range(c)] for i in range(r)]


def _matrix_op_tambah(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    if rA != rB or cA != cB:
        raise ValueError(f'Ukuran tidak cocok! Penjumlahan mensyaratkan kedua matriks berukuran sama persis atau tidak terdefinisi. Matriks {nameA} berukuran {rA}×{cA}, sedangkan Matriks {nameB} berukuran {rB}×{cB}.')

    inter_rows = []
    for i in range(rA):
        row = []
        for j in range(cA):
            a_str = sp.latex(A[i, j])
            b_str = sp.latex(B[i, j])
            row.append(f'{a_str} + ({b_str})' if _is_negative(B[i, j]) else f'{a_str} + {b_str}')
        inter_rows.append(' & '.join(row))
    inter_latex = '\\begin{bmatrix}' + ' \\\\ '.join(inter_rows) + '\\end{bmatrix}'

    res = A + B
    steps = [
        {'judul': '1. Periksa Ordo Matriks', 'teks': f'Kedua matriks memiliki ordo yang sama yaitu {rA} \\times {cA}. Syarat penjumlahan terpenuhi.'},
        {'judul': '2. Rumus Penjumlahan', 'teks': 'Setiap elemen pada posisi yang bersesuaian dijumlahkan: c_{ij} = a_{ij} + b_{ij}'},
        {'judul': '3. Proses Penjumlahan Elemen', 'latex': f'{nameA} + {nameB} = {inter_latex}'},
        {'judul': '4. Hasil Akhir', 'latex': f'{nameA} + {nameB} = {sp.latex(res)}'}
    ]
    return {
        'sukses': True, 'operasi': 'tambah', 'notasi': f"{nameA} + {nameB}",
        'hasil_latex': sp.latex(res), 'hasil_grid': _matrix_to_list(res),
        'baris': res.shape[0], 'kolom': res.shape[1], 'langkah': steps
    }


def _matrix_op_kurang(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    if rA != rB or cA != cB:
        raise ValueError(f'Ukuran tidak cocok! Pengurangan mensyaratkan kedua matriks berukuran sama persis atau tidak terdefinisi. Matriks {nameA} berukuran {rA}×{cA}, sedangkan Matriks {nameB} berukuran {rB}×{cB}.')

    inter_rows = []
    for i in range(rA):
        row = []
        for j in range(cA):
            a_str = sp.latex(A[i, j])
            b_str = sp.latex(B[i, j])
            row.append(f'{a_str} - ({b_str})' if _is_negative(B[i, j]) else f'{a_str} - {b_str}')
        inter_rows.append(' & '.join(row))
    inter_latex = '\\begin{bmatrix}' + ' \\\\ '.join(inter_rows) + '\\end{bmatrix}'

    res = A - B
    steps = [
        {'judul': '1. Periksa Ordo Matriks', 'teks': f'Kedua matriks memiliki ordo yang sama yaitu {rA} \\times {cA}. Syarat pengurangan terpenuhi.'},
        {'judul': '2. Rumus Pengurangan', 'teks': 'Setiap elemen pada posisi yang bersesuaian dikurangkan: c_{ij} = a_{ij} - b_{ij}'},
        {'judul': '3. Proses Pengurangan Elemen', 'latex': f'{nameA} - {nameB} = {inter_latex}'},
        {'judul': '4. Hasil Akhir', 'latex': f'{nameA} - {nameB} = {sp.latex(res)}'}
    ]
    return {
        'sukses': True, 'operasi': 'kurang', 'notasi': f"{nameA} - {nameB}",
        'hasil_latex': sp.latex(res), 'hasil_grid': _matrix_to_list(res),
        'baris': res.shape[0], 'kolom': res.shape[1], 'langkah': steps
    }


def _matrix_op_kali(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    if cA != rB:
        raise ValueError(f'Ukuran tidak cocok untuk perkalian atau tidak terdefinisi! Jumlah Kolom Matriks {nameA} ({cA}) harus sama dengan Jumlah Baris Matriks {nameB} ({rB}). (Syarat: perkalian matriks {rA}×{cA} dengan {rB}×{cB} hanya bisa jika {cA} = {rB}).')

    calc_items = []
    for i in range(rA):
        for j in range(cB):
            terms = []
            terms_val = []
            for k in range(cA):
                a_val = A[i, k]
                b_val = B[k, j]
                a_str = f'({sp.latex(a_val)})' if _is_negative(a_val) else sp.latex(a_val)
                b_str = f'({sp.latex(b_val)})' if _is_negative(b_val) else sp.latex(b_val)
                terms.append(f'{a_str} \\cdot {b_str}')
                terms_val.append(a_val * b_val)
            expr_str = ' + '.join(terms).replace('+ -', '- ')
            val_res = sum(terms_val)
            calc_items.append(f'c_{{{i+1}{j+1}}} = {expr_str} = {sp.latex(val_res)}')

    res = A * B
    steps = [
        {'judul': '1. Periksa Syarat Dimensi Perkalian', 'teks': f'Kolom matriks {nameA} ({cA}) sama dengan baris matriks {nameB} ({rB}). Perkalian dapat dilakukan dan menghasilkan matriks berordo {rA} \\times {cB}.'},
        {'judul': '2. Konsep Perkalian Matriks (Baris kali Kolom)', 'teks': 'Setiap elemen baris i pada matriks pertama dikalikan dengan kolom j pada matriks kedua lalu dijumlahkan: c_{ij} = \\sum_{k=1}^n a_{ik} \\cdot b_{kj}'},
        {'judul': '3. Rincian Perhitungan Setiap Elemen', 'items': calc_items},
        {'judul': '4. Hasil Akhir Perkalian', 'latex': f'{nameA} \\times {nameB} = {sp.latex(res)}'}
    ]
    return {
        'sukses': True, 'operasi': 'kali', 'notasi': f"{nameA} \\times {nameB}",
        'hasil_latex': sp.latex(res), 'hasil_grid': _matrix_to_list(res),
        'baris': res.shape[0], 'kolom': res.shape[1], 'langkah': steps
    }


def _matrix_op_bagi(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    if rB != cB:
        raise ValueError(f'Matriks pembagi ({nameB}) harus berupa matriks persegi (bujursangkar, ordo n×n) agar memiliki invers atau tidak terdefinisi. Saat ini {nameB} berukuran {rB}×{cB}.')

    det_B = B.det()
    if det_B == 0:
        raise ValueError(f'Matriks pembagi ({nameB}) memiliki determinan = 0 (matriks singular). Matriks yang determinannya 0 tidak memiliki invers, sehingga operasi pembagian tidak terdefinisi.')

    if cA != rB:
        raise ValueError(f'Kolom Matriks {nameA} ({cA}) tidak sama dengan baris Matriks {nameB} ({rB}) atau tidak terdefinisi. Perkalian {nameA} \\times {nameB}^{{-1}} memerlukan Kolom {nameA} = Baris {nameB}.')

    det_latex = sp.latex(det_B)
    steps = [
        {'judul': '1. Konsep Pembagian Matriks', 'teks': f'Dalam aljabar linear, pembagian matriks {nameA} \\div {nameB} dihitung sebagai perkalian dengan invers matriks pembagi: {nameA} \\times {nameB}^{{-1}}.'}
    ]

    if rB == 2:
        steps.append({
            'judul': f'2. Hitung Determinan Matriks Pembagi {nameB}',
            'teks': f'Rumus determinan 2×2: \\det({nameB}) = (a \\cdot d) - (b \\cdot c)',
            'latex': f'\\det({nameB}) = ({sp.latex(B[0,0])} \\cdot {sp.latex(B[1,1])}) - ({sp.latex(B[0,1])} \\cdot {sp.latex(B[1,0])}) = {det_latex} \\neq 0 \\quad (\\text{{Invers ada}})'
        })
    else:
        steps.append({
            'judul': f'2. Hitung Determinan Matriks Pembagi {nameB}',
            'teks': f'Determinan matriks {nameB} berordo {rB} \\times {cB}:',
            'latex': f'\\det({nameB}) = {det_latex} \\neq 0 \\quad (\\text{{Invers ada}})'
        })

    B_inv = B.inv()
    steps.append({
        'judul': f'3. Cari Invers Matriks {nameB}^{{-1}}',
        'teks': f'Rumus invers: {nameB}^{{-1}} = \\frac{{1}}{{\\det({nameB})}} \\operatorname{{adj}}({nameB})',
        'latex': f'{nameB}^{{-1}} = {sp.latex(B_inv)}'
    })

    res = A * B_inv
    steps.append({
        'judul': f'4. Kalikan {nameA} dengan {nameB}^{{-1}}',
        'latex': f'{nameA} \\times {nameB}^{{-1}} = {sp.latex(A)} \\times {sp.latex(B_inv)} = {sp.latex(res)}'
    })
    steps.append({
        'judul': '5. Hasil Akhir Pembagian',
        'latex': f'{nameA} \\div {nameB} = {sp.latex(res)}'
    })
    return {
        'sukses': True, 'operasi': 'bagi', 'notasi': f"{nameA} \\div {nameB}",
        'hasil_latex': sp.latex(res), 'hasil_grid': _matrix_to_list(res),
        'baris': res.shape[0], 'kolom': res.shape[1], 'langkah': steps
    }


def _matrix_op_invers(A, nameA):
    rA, cA = A.shape
    if rA != cA:
        raise ValueError(f'Matriks {nameA} harus berupa matriks persegi (ordo n×n) untuk mencari invers atau tidak terdefinisi. Saat ini berukuran {rA}×{cA}.')
    det_A = A.det()
    if det_A == 0:
        raise ValueError(f'Matriks {nameA} memiliki determinan = 0 (matriks singular). Matriks singular tidak memiliki invers atau tidak terdefinisi.')
    A_inv = A.inv()
    steps = [
        {'judul': '1. Periksa Syarat Invers', 'teks': f'Matriks {nameA} adalah matriks persegi {rA} \\times {cA}. Determinan \\det({nameA}) = {sp.latex(det_A)} \\neq 0, maka invers ada.'},
        {'judul': '2. Hasil Invers', 'latex': f'{nameA}^{{-1}} = {sp.latex(A_inv)}'}
    ]
    return {
        'sukses': True, 'operasi': 'invers', 'notasi': f"{nameA}^{{-1}}",
        'hasil_latex': sp.latex(A_inv), 'hasil_grid': _matrix_to_list(A_inv),
        'baris': A_inv.shape[0], 'kolom': A_inv.shape[1], 'langkah': steps
    }


def _matrix_op_determinan(A, nameA):
    rA, cA = A.shape
    if rA != cA:
        raise ValueError(f'Determinan hanya dapat dihitung untuk matriks persegi (n×n) atau tidak terdefinisi. Matriks {nameA} berukuran {rA}×{cA}.')
    det_A = A.det()
    steps = [
        {'judul': '1. Ordo Matriks', 'teks': f'Matriks {nameA} adalah matriks persegi {rA} \\times {cA}.'}
    ]
    if rA == 2:
        steps.append({
            'judul': '2. Perhitungan Determinan (2×2)',
            'latex': f'\\det({nameA}) = ({sp.latex(A[0,0])} \\cdot {sp.latex(A[1,1])}) - ({sp.latex(A[0,1])} \\cdot {sp.latex(A[1,0])}) = {sp.latex(det_A)}'
        })
    else:
        steps.append({
            'judul': '2. Nilai Determinan',
            'latex': f'\\det({nameA}) = {sp.latex(det_A)}'
        })
    return {
        'sukses': True, 'operasi': 'determinan', 'notasi': f"\\det({nameA})",
        'hasil_latex': sp.latex(det_A), 'hasil_grid': [[str(det_A)]],
        'baris': 1, 'kolom': 1, 'langkah': steps
    }


def _matrix_op_transpose(A, nameA):
    A_T = A.T
    steps = [
        {'judul': '1. Konsep Transpose', 'teks': 'Mengubah baris menjadi kolom dan kolom menjadi baris: (A^T)_{ij} = A_{ji}'},
        {'judul': '2. Hasil Transpose', 'latex': f'{nameA}^T = {sp.latex(A_T)}'}
    ]
    return {
        'sukses': True, 'operasi': 'transpose', 'notasi': f"{nameA}^T",
        'hasil_latex': sp.latex(A_T), 'hasil_grid': _matrix_to_list(A_T),
        'baris': A_T.shape[0], 'kolom': A_T.shape[1], 'langkah': steps
    }


def _matrix_op_skalar(A, nameA, skalar_val):
    k_val = _parse_matrix_cell(skalar_val)
    res = k_val * A
    steps = [
        {'judul': '1. Konsep Perkalian Skalar', 'teks': f'Setiap elemen dalam matriks dikalikan dengan skalar k = {sp.latex(k_val)}.'},
        {'judul': '2. Hasil Perkalian Skalar', 'latex': f'{sp.latex(k_val)} \\cdot {nameA} = {sp.latex(res)}'}
    ]
    return {
        'sukses': True, 'operasi': 'skalar', 'notasi': f"{sp.latex(k_val)} \\cdot {nameA}",
        'hasil_latex': sp.latex(res), 'hasil_grid': _matrix_to_list(res),
        'baris': res.shape[0], 'kolom': res.shape[1], 'langkah': steps
    }


def _calc_matrix_logic(op, A_grid, B_grid=None, nameA='A', nameB='B', skalar_val=1):
    """Dispatcher modular kalkulator matriks."""
    A = _matrix_from_json(A_grid, f'Matriks {nameA}')

    if op in ('tambah', 'kurang', 'kali', 'bagi'):
        if not B_grid:
            raise ValueError(f'Matriks kedua ({nameB}) diperlukan untuk operasi {op}')
        B = _matrix_from_json(B_grid, f'Matriks {nameB}')
        if op == 'tambah':
            return _matrix_op_tambah(A, B, nameA, nameB)
        elif op == 'kurang':
            return _matrix_op_kurang(A, B, nameA, nameB)
        elif op == 'kali':
            return _matrix_op_kali(A, B, nameA, nameB)
        elif op == 'bagi':
            return _matrix_op_bagi(A, B, nameA, nameB)

    elif op == 'invers':
        return _matrix_op_invers(A, nameA)
    elif op == 'determinan':
        return _matrix_op_determinan(A, nameA)
    elif op == 'transpose':
        return _matrix_op_transpose(A, nameA)
    elif op == 'skalar':
        return _matrix_op_skalar(A, nameA, skalar_val)
    else:
        raise ValueError(f'Operasi "{op}" tidak dikenali.')


# =============================================================================
# SECTION 6: SECURITY MIDDLEWARE & ERROR HANDLERS
# =============================================================================
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()'
    if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
    csp = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: https: blob:; "
        "connect-src 'self' blob:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    response.headers['Content-Security-Policy'] = csp
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    return response


@app.before_request
def before_request_security():
    if request.path.startswith('/api/') and request.method == 'POST':
        ctype = request.headers.get('Content-Type', '')
        if ctype and 'application/json' not in ctype:
            return jsonify({'sukses': False, 'error': 'Content-Type harus application/json'}), 415


@app.errorhandler(413)
def too_large(e):
    return jsonify({'sukses': False, 'error': 'Payload terlalu besar (maks 16KB)'}), 413


@app.errorhandler(429)
def ratelimited(e):
    return jsonify({'sukses': False, 'error': 'Terlalu banyak request, coba lagi nanti', 'retry_after': 30}), 429


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'sukses': False, 'error': 'Request tidak valid'}), 400


# =============================================================================
# SECTION 7: API ROUTES & VIEWS
# =============================================================================
@app.route('/')
@rate_limit(api_limit=30, api_window=60, burst_limit=30, burst_window=10, global_limit=120, global_window=60)
def index():
    return render_template('index.html')


@app.route('/api/turunan', methods=['POST'])
@rate_limit(api_limit=30, api_window=60, burst_limit=20, burst_window=10, global_limit=60, global_window=60)
def turunan():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'sukses': False, 'error': 'Body JSON tidak valid atau kosong'}), 400
    expr_str = str(data.get('fungsi', '')).strip()
    orde_raw = data.get('orde', 1)
    point_val = data.get('titik')

    ok, msg = validate_fungsi(expr_str)
    if not ok:
        return jsonify({'sukses': False, 'error': msg}), 400
    try:
        orde = int(orde_raw)
    except Exception:
        return jsonify({'sukses': False, 'error': 'Orde harus angka 1-10'}), 400
    if not 1 <= orde <= MAX_ORDE:
        return jsonify({'sukses': False, 'error': f'Orde harus 1–{MAX_ORDE}'}), 400

    if point_val not in (None, ''):
        try:
            float(point_val)
            if len(str(point_val)) > 20:
                return jsonify({'sukses': False, 'error': 'Titik terlalu panjang'}), 400
        except Exception:
            return jsonify({'sukses': False, 'error': 'Titik harus angka'}), 400

    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'}), 400
        var = _detect_var(f_expr, _get_requested_var(data))
        var_name = str(var)

        def do_diff():
            return sp.simplify(sp.diff(f_expr, var, orde))

        derivative_expr = run_with_timeout(do_diff, timeout=SYMPY_TIMEOUT)

        result = {
            'sukses': True,
            'hasil': sp.latex(derivative_expr),
            'hasil_str': str(derivative_expr),
            'fungsi_str': expr_str,
            'variabel': var_name,
        }
        if orde == 1:
            result['notasi'] = f"\\frac{{d}}{{d{var_name}}} ({sp.latex(f_expr)})"
        elif orde == 2:
            result['notasi'] = f"\\frac{{d^2}}{{d{var_name}^2}} ({sp.latex(f_expr)})"
        elif orde == 3:
            result['notasi'] = f"\\frac{{d^3}}{{d{var_name}^3}} ({sp.latex(f_expr)})"
        else:
            result['notasi'] = f"\\frac{{d^{{{orde}}}}}{{d{var_name}^{{{orde}}}}} ({sp.latex(f_expr)})"

        evaluated = None
        if point_val not in (None, ''):
            pv = sp.nsimplify(float(point_val))
            evaluated = derivative_expr.subs(var, pv)
            result['evaluasi'] = sp.latex(evaluated)
            result['evaluasi_str'] = str(evaluated)
            result['titik'] = str(pv)

        plot_png, plot_svg = plot_derivative(
            f_expr, derivative_expr, expr_str, orde,
            float(sp.nsimplify(float(point_val))) if point_val not in (None, '') else None,
            evaluated, var=var
        )
        result['plot'] = plot_png
        result['plot_svg'] = plot_svg
        return jsonify(result)
    except TimeoutError as te:
        return jsonify({'sukses': False, 'error': str(te)}), 408
    except Exception:
        logger.exception("turunan error")
        return jsonify({'sukses': False, 'error': 'Terjadi kesalahan internal (turunan)'}), 500


@app.route('/api/integral', methods=['POST'])
@rate_limit(api_limit=20, api_window=60, burst_limit=15, burst_window=10, global_limit=60, global_window=60)
def integral():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'sukses': False, 'error': 'Body JSON tidak valid atau kosong'}), 400
    expr_str = str(data.get('fungsi', '')).strip()
    batas_bawah = data.get('batas_bawah')
    batas_atas = data.get('batas_atas')

    ok, msg = validate_fungsi(expr_str)
    if not ok:
        return jsonify({'sukses': False, 'error': msg}), 400

    has_bawah = batas_bawah not in (None, '')
    has_atas = batas_atas not in (None, '')
    if has_bawah != has_atas:
        return jsonify({'sukses': False, 'error': 'Isi kedua batas (bawah & atas) untuk integral tentu'}), 400

    for b in [batas_bawah, batas_atas]:
        if b not in (None, ''):
            try:
                float(b)
                if len(str(b)) > 20:
                    return jsonify({'sukses': False, 'error': 'Batas terlalu panjang'}), 400
            except Exception:
                return jsonify({'sukses': False, 'error': 'Batas harus angka'}), 400

    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'}), 400
        var = _detect_var(f_expr, _get_requested_var(data))
        var_name = str(var)

        def do_integral():
            return simplify_integral(sp.integrate(f_expr, var))

        indef_expr = run_with_timeout(do_integral, timeout=SYMPY_TIMEOUT)
        latex_input = sp.latex(f_expr)
        result = {
            'sukses': True,
            'hasil': sp.latex(indef_expr),
            'hasil_str': str(indef_expr),
            'fungsi_str': expr_str,
            'notasi': f"\\int {latex_input}\\,d{var_name}",
            'variabel': var_name,
        }

        if has_bawah and has_atas:
            lb = sp.nsimplify(float(batas_bawah))
            ub = sp.nsimplify(float(batas_atas))

            def do_def():
                return sp.integrate(f_expr, (var, lb, ub))

            def_val = run_with_timeout(do_def, timeout=SYMPY_TIMEOUT)
            result['tentu'] = sp.latex(def_val)
            result['tentu_str'] = str(def_val)
            result['notasi'] = f"\\int_{{{sp.latex(lb)}}}^{{{sp.latex(ub)}}} {latex_input}\\,d{var_name}"
            plot_png, plot_svg = plot_integral(f_expr, indef_expr, expr_str, lb, ub, def_val, var=var)
        else:
            plot_png, plot_svg = plot_integral(f_expr, indef_expr, expr_str, -5, 5, sp.Integral(f_expr, var), var=var)

        result['plot'] = plot_png
        result['plot_svg'] = plot_svg
        return jsonify(result)
    except TimeoutError as te:
        return jsonify({'sukses': False, 'error': str(te)}), 408
    except Exception:
        logger.exception("integral error")
        return jsonify({'sukses': False, 'error': 'Terjadi kesalahan internal (integral)'}), 500


@app.route('/api/limit', methods=['POST'])
@rate_limit(api_limit=30, api_window=60, burst_limit=20, burst_window=10, global_limit=60, global_window=60)
def limit():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'sukses': False, 'error': 'Body JSON tidak valid atau kosong'}), 400
    expr_str = str(data.get('fungsi', '')).strip()
    titik = str(data.get('titik', '0')).strip()
    arah = str(data.get('arah', '+-')).strip()

    ok, msg = validate_fungsi(expr_str)
    if not ok:
        return jsonify({'sukses': False, 'error': msg}), 400
    if arah not in ('+', '-', '+-'):
        return jsonify({'sukses': False, 'error': 'Arah harus +, -, atau +-'}), 400
    try:
        float(titik)
        if len(titik) > 20:
            return jsonify({'sukses': False, 'error': 'Titik terlalu panjang'}), 400
    except Exception:
        return jsonify({'sukses': False, 'error': 'Titik harus angka'}), 400

    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'}), 400
        var = _detect_var(f_expr, _get_requested_var(data))
        var_name = str(var)

        titik_num = float(titik)
        if titik_num == int(titik_num):
            titik_num = int(titik_num)
        point_sym = sp.nsimplify(titik_num)

        def do_limit():
            return sp.limit(f_expr, var, point_sym, dir=arah)

        limit_val = run_with_timeout(do_limit, timeout=SYMPY_TIMEOUT)

        dir_label = {'+': '^+', '-': '^-', '+-': ''}.get(arah, '')
        result = {
            'sukses': True,
            'hasil': sp.latex(limit_val),
            'hasil_str': str(limit_val),
            'fungsi_str': expr_str,
            'notasi': f"\\lim_{{{var_name} \\to {sp.latex(point_sym)}{dir_label}}} {sp.latex(f_expr)}",
            'variabel': var_name,
        }
        plot_png, plot_svg = plot_limit(f_expr, expr_str, point_sym, limit_val, arah, var=var)
        result['plot'] = plot_png
        result['plot_svg'] = plot_svg
        return jsonify(result)
    except TimeoutError as te:
        return jsonify({'sukses': False, 'error': str(te)}), 408
    except Exception:
        logger.exception("limit error")
        return jsonify({'sukses': False, 'error': 'Terjadi kesalahan internal (limit)'}), 500


@app.route('/api/matrix', methods=['POST'])
@rate_limit(api_limit=30, api_window=60, burst_limit=20, burst_window=10, global_limit=60, global_window=60)
def matrix():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'sukses': False, 'error': 'Body JSON tidak valid atau kosong'}), 400

    operasi = str(data.get('operasi', 'tambah')).strip().lower()
    matriks_a = data.get('matriks_a', {})
    matriks_b = data.get('matriks_b', {})
    skalar = data.get('skalar', 1)

    nama_a = str(matriks_a.get('nama', 'A')).strip()[:10] or 'A'
    nama_b = str(matriks_b.get('nama', 'B')).strip()[:10] or 'B'
    grid_a = matriks_a.get('data', [])
    grid_b = matriks_b.get('data', []) if matriks_b else None

    try:
        def do_calc():
            return _calc_matrix_logic(
                op=operasi,
                A_grid=grid_a,
                B_grid=grid_b,
                nameA=nama_a,
                nameB=nama_b,
                skalar_val=skalar
            )
        result = run_with_timeout(do_calc, timeout=SYMPY_TIMEOUT)
        return jsonify(result)
    except TimeoutError as te:
        return jsonify({'sukses': False, 'error': str(te)}), 408
    except ValueError as ve:
        return jsonify({'sukses': False, 'error': str(ve)}), 400
    except Exception as e:
        logger.exception("matrix calculation error")
        return jsonify({'sukses': False, 'error': f'Terjadi kesalahan saat menghitung matriks: {str(e)}'}), 500


@app.route('/health')
@rate_limit(api_limit=60, api_window=60, burst_limit=30, burst_window=10, global_limit=120, global_window=60)
def health():
    return jsonify({"status": "ok"}), 200


# =============================================================================
# SECTION 8: SERVER RUNNER
# =============================================================================
if __name__ == '__main__':
    env = os.environ.get('FLASK_ENV', 'production')
    is_dev = env == 'development' or os.environ.get('DEBUG') == '1'
    port = int(os.environ.get('PORT', 5050))
    debug = is_dev
    if is_dev:
        logger.warning("Running in DEVELOPMENT mode (debug=True) — jangan pakai di production!")
    else:
        logger.info("Running in PRODUCTION mode (debug=False) — rate limit & security headers aktif")
    app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=False)