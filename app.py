from flask import Flask, render_template, request, jsonify, g
import sympy as sp
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import io
import base64
import re
import os
import time
import functools
import threading
import logging
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
)

# ---------------------------------------------------------------------------
# Flask app + Hardening Config
# ---------------------------------------------------------------------------
app = Flask(__name__)
try:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
except ImportError:
    pass

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024
app.config['JSON_AS_ASCII'] = False
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32).hex()
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

x = sp.Symbol('x')
y = sp.Symbol('y')

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
VARS = {'x': x, 'y': y}

# ---------------------------------------------------------------------------
# Keamanan Input
# ---------------------------------------------------------------------------
MAX_FUNCTION_LENGTH = 200
MAX_ORDE = 10
_BLOCKED_KEYWORDS = ['__', 'import', 'exec', 'eval', 'open', 'os.', 'sys.', 'subprocess', 'compile', 'globals', 'locals', 'getattr', 'setattr']
_BLOCKED_CHARS_RE = re.compile(r'[;`$\\\'"#@!&?<>:~]')
SYMPY_TIMEOUT = 5
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sympy")


def validate_fungsi(expr_str):
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


# ---------------------------------------------------------------------------
# Rate Limiting
# ---------------------------------------------------------------------------
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
            elif not dq:
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
            bucket_burst  = f"burst_{burst_limit}_{burst_window}"
            bucket_api    = f"api_{api_limit}_{api_window}"
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


# ---------------------------------------------------------------------------
# Timeout wrapper
# ---------------------------------------------------------------------------
def run_with_timeout(func, *args, timeout=SYMPY_TIMEOUT, **kwargs):
    future = _executor.submit(func, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        raise TimeoutError(f"Kalkulasi terlalu lama / terlalu kompleks (timeout {timeout}s). Coba sederhanakan fungsi.")


# ---------------------------------------------------------------------------
# Helper parsing & variabel
# ---------------------------------------------------------------------------
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
    try:
        func_str = func_str.replace('^', '**')
        func_str = re.sub(r'\be\b', 'E', func_str)
        func_str = re.sub(r'(\d)([a-zA-Z])', r'\1*\2', func_str)
        func_str = re.sub(r'([xy])\(', r'\1*(', func_str)
        func_str = re.sub(r'\)\(', r')*(', func_str)
        func_str = re.sub(r'\)([a-zA-Z])', r')*\1', func_str)
        func_str = re.sub(r'(\d)\(', r'\1*(', func_str)
        return parse_expr(func_str, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
    except Exception:
        return None


def sympy_to_numpy(expr, var=None):
    if var is None:
        var = _detect_var(expr)
    return sp.lambdify(var, expr, 'numpy')



def fig_to_png_svg(fig):
    """Generate PNG base64 and SVG string from same figure (for download SVG/PNG)."""
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


# ---------------------------------------------------------------------------
# Helper y-limit konsisten untuk semua grafik
# ---------------------------------------------------------------------------
def _apply_ylim(ax, *y_arrays, padding=0.12, fallback=(-5, 5), abs_max=1e6):
    """
    Hitung y-limit dari semua array, terapkan ke ax secara konsisten.
    - padding : fraksi rentang yang ditambah di atas/bawah (default 12%)
    - fallback: rentang default jika tidak ada nilai finite sama sekali
    - abs_max : clamp nilai ekstrem (mis. dari asymptote)
    """
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


# ---------------------------------------------------------------------------
# Plot functions — konsisten: tema, grid, ylim, linewidth, marker semua sama
# ---------------------------------------------------------------------------
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
        _style_ax(ax,
                  title=f'Limit di {var_name} \u2192 {point_sym}',
                  xlabel=var_name, ylabel=f'f({var_name})')
    except Exception:
        pass
    return fig_to_png_svg(fig)


def plot_derivative(f_expr, derivative_expr, func_str, order, point_val, evaluated, var=None):
    if var is None:
        var = _detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        f_numpy = sympy_to_numpy(f_expr, var)
        d_numpy = sympy_to_numpy(derivative_expr, var)
        x_min = (point_val - 3) if point_val is not None else -5
        x_max = (point_val + 3) if point_val is not None else  5
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

        if (point_val is not None
                and evaluated is not None
                and evaluated.is_finite
                and evaluated.is_real):
            ax.plot(point_val, float(evaluated), 'o',
                    color='#22c55e', markersize=9,
                    markeredgecolor='white', markeredgewidth=1.2,
                    label=f"f'({point_val}) = {float(evaluated):.4f}", zorder=4)
            ax.axvline(point_val, color='#475569', linestyle=':', linewidth=0.9, alpha=0.6, zorder=2)
            ax.axhline(float(evaluated), color='#475569', linestyle=':', linewidth=0.8, alpha=0.5, zorder=2)

        _apply_ylim(ax, y_f, y_d)
        _style_ax(ax,
                  title=f'Turunan ke-{order} terhadap {var_name}',
                  xlabel=var_name, ylabel='y')
    except Exception:
        pass
    return fig_to_png_svg(fig)


def simplify_integral(expr):
    candidates = [
        expr,
        sp.factor(expr),
        sp.simplify(expr),
        sp.radsimp(expr),
        sp.powsimp(expr, deep=True),
    ]
    return min(candidates, key=lambda e: len(str(e)))


def plot_integral(f_expr, indef_expr, func_str, lb, ub, def_val, var=None):
    if var is None:
        var = _detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        f_numpy   = sympy_to_numpy(f_expr, var)
        ind_numpy = sympy_to_numpy(indef_expr, var)

        lb_f, ub_f = float(lb), float(ub)
        is_indefinite = isinstance(def_val, sp.Integral)

        if is_indefinite:
            x_plot = np.linspace(-5, 5, 400)
        else:
            margin = max((ub_f - lb_f) * 0.4, 1.5)
            x_plot = np.linspace(lb_f - margin, ub_f + margin, 400)

        y_f   = f_numpy(x_plot)
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
            ax.fill_between(x_fill, y_fill,
                            color='#a855f7', alpha=0.30,
                            label=label_area, zorder=2)
            ax.axvline(lb_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)
            ax.axvline(ub_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)

        _apply_ylim(ax, y_f, y_ind)
        _style_ax(ax,
                  title='Grafik Fungsi dan Integral',
                  xlabel=var_name, ylabel='y')
    except Exception:
        pass
    return fig_to_png_svg(fig)


# ---------------------------------------------------------------------------
# Security Headers
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Error Handlers
# ---------------------------------------------------------------------------
@app.errorhandler(413)
def too_large(e):
    return jsonify({'sukses': False, 'error': 'Payload terlalu besar (maks 16KB)'}), 413

@app.errorhandler(429)
def ratelimited(e):
    return jsonify({'sukses': False, 'error': 'Terlalu banyak request, coba lagi nanti', 'retry_after': 30}), 429

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'sukses': False, 'error': 'Request tidak valid'}), 400


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
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
    expr_str  = str(data.get('fungsi', '')).strip()
    orde_raw  = data.get('orde', 1)
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
            d = sp.diff(f_expr, var, orde)
            return sp.simplify(d)
        try:
            derivative_expr = run_with_timeout(do_diff, timeout=SYMPY_TIMEOUT)
        except TimeoutError as te:
            return jsonify({'sukses': False, 'error': str(te)}), 408

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
            result['evaluasi']     = sp.latex(evaluated)
            result['evaluasi_str'] = str(evaluated)
            result['titik']        = str(pv)

        plot_png, plot_svg = plot_derivative(
            f_expr, derivative_expr, expr_str, orde,
            float(sp.nsimplify(float(point_val))) if point_val not in (None, '') else None,
            evaluated, var=var)
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
    expr_str    = str(data.get('fungsi', '')).strip()
    batas_bawah = data.get('batas_bawah')
    batas_atas  = data.get('batas_atas')

    ok, msg = validate_fungsi(expr_str)
    if not ok:
        return jsonify({'sukses': False, 'error': msg}), 400
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
            raw = sp.integrate(f_expr, var)
            return simplify_integral(raw)
        try:
            indef_expr = run_with_timeout(do_integral, timeout=SYMPY_TIMEOUT)
        except TimeoutError as te:
            return jsonify({'sukses': False, 'error': str(te)}), 408

        latex_input = sp.latex(f_expr)
        result = {
            'sukses': True,
            'hasil': sp.latex(indef_expr),
            'hasil_str': str(indef_expr),
            'fungsi_str': expr_str,
            'notasi': f"\\int {latex_input}\\,d{var_name}",
            'variabel': var_name,
        }

        if batas_bawah not in (None, '') and batas_atas not in (None, ''):
            pass
        elif batas_bawah not in (None, '') or batas_atas not in (None, ''):
            return jsonify({'sukses': False, 'error': 'Isi kedua batas (bawah & atas) untuk integral tentu'}), 400

        if batas_bawah not in (None, '') and batas_atas not in (None, ''):
            lb = sp.nsimplify(float(batas_bawah))
            ub = sp.nsimplify(float(batas_atas))

            def do_def():
                return sp.integrate(f_expr, (var, lb, ub))
            try:
                def_val = run_with_timeout(do_def, timeout=SYMPY_TIMEOUT)
            except TimeoutError as te:
                return jsonify({'sukses': False, 'error': str(te)}), 408

            result['tentu']     = sp.latex(def_val)
            result['tentu_str'] = str(def_val)
            result['notasi']    = f"\\int_{{{sp.latex(lb)}}}^{{{sp.latex(ub)}}} {latex_input}\\,d{var_name}"
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
    titik    = str(data.get('titik', '0')).strip()
    arah     = str(data.get('arah', '+-')).strip()

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
        try:
            limit_val = run_with_timeout(do_limit, timeout=SYMPY_TIMEOUT)
        except TimeoutError as te:
            return jsonify({'sukses': False, 'error': str(te)}), 408

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


@app.route('/health')
@rate_limit(api_limit=60, api_window=60, burst_limit=30, burst_window=10, global_limit=120, global_window=60)
def health():
    return jsonify({"status": "ok"}), 200


if __name__ == '__main__':
    env    = os.environ.get('FLASK_ENV', 'production')
    is_dev = env == 'development' or os.environ.get('DEBUG') == '1'
    port   = int(os.environ.get('PORT', 5050))
    debug  = is_dev
    if is_dev:
        logger.warning("Running in DEVELOPMENT mode (debug=True) — jangan pakai di production!")
    else:
        logger.info("Running in PRODUCTION mode (debug=False) — rate limit & security headers aktif")
    app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=False)