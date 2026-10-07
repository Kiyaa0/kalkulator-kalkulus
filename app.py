"""
app.py
Aplikasi Web Kalkulator Kalkulus & Aljabar Linear (CalcKu).
Backend Flask modular, aman, teroptimasi, bebas dari fungsi berulang.
"""
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import functools
import logging
import os
import threading
import time

from flask import Flask, jsonify, render_template, request

# Import fungsi dan konfigurasi dari paket core
from core import (
    MAX_ORDE,
    SYMPY_TIMEOUT,
    validate_fungsi,
    parse_function,
    detect_var,
    get_requested_var,
    parse_numeric_or_symbolic,
    compute_derivative,
    compute_integral,
    compute_limit,
    compute_natural_domain_and_analysis,
    plot_derivative,
    plot_integral,
    plot_limit,
    calc_matrix_logic
)

# =============================================================================
# SECTION 1: INISIALISASI & KONFIGURASI FLASK
# =============================================================================
app = Flask(__name__)

try:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
except ImportError:
    pass

env = os.environ.get('FLASK_ENV', 'production')
is_dev = env == 'development' or os.environ.get('DEBUG') == '1'

app.config['MAX_CONTENT_LENGTH'] = 32 * 1024  # 32 KB max payload
app.config['JSON_AS_ASCII'] = False
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32).hex()
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['TEMPLATES_AUTO_RELOAD'] = is_dev
app.jinja_env.auto_reload = is_dev

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sympy_worker")


# =============================================================================
# SECTION 2: RATE LIMITER & KEAMANAN
# =============================================================================
_lock = threading.Lock()
_request_logs = defaultdict(lambda: defaultdict(deque))
_last_cleanup = time.time()
CLEANUP_INTERVAL = 60
MAX_TRACKED_IPS = 5000  # Hash table bloat


def _get_client_ip():
    """Mengambil IP klien asli dari remote_addr (yang sudah diamankan oleh ProxyFix)."""
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
    if now - _last_cleanup < CLEANUP_INTERVAL and len(_request_logs) < MAX_TRACKED_IPS:
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

    # Proteksi DoS: jika IP aktif melebihi MAX_TRACKED_IPS, eviksi separuh IP tertua
    if len(_request_logs) > MAX_TRACKED_IPS:
        excess = len(_request_logs) - (MAX_TRACKED_IPS // 2)
        for k in list(_request_logs.keys())[:excess]:
            _request_logs.pop(k, None)


def _rate_limit_response(msg, retry):
    resp = jsonify({
        "sukses": False,
        "error": msg,
        "retry_after": retry
    })
    resp.status_code = 429
    resp.headers["Retry-After"] = str(retry)
    return resp


def rate_limit(api_limit=40, api_window=60, burst_limit=25, burst_window=10, global_limit=80, global_window=60):
    def decorator(f):
        @functools.wraps(f)
        def wrapped(*args, **kwargs):
            ip = _get_client_ip()
            with _lock:
                _maybe_cleanup()

                checks = [
                    ('global', global_limit, global_window, "Terlalu banyak permintaan. Mohon tunggu {retry} detik.", "Global rate limit hit"),
                    (f'burst:{request.path}', burst_limit, burst_window, "Aktivitas terlalu cepat. Mohon tunggu {retry} detik.", "Burst limit hit"),
                    (f'api:{request.path}', api_limit, api_window, "Limit penggunaan tercapai. Silakan coba lagi dalam {retry} detik.", "API rate limit hit")
                ]
                for bucket, limit, window, err_tpl, log_msg in checks:
                    limited, retry = _is_rate_limited(ip, bucket, limit, window)
                    if limited:
                        logger.warning(f"{log_msg} ip={ip} path={request.path}")
                        return _rate_limit_response(err_tpl.format(retry=retry), retry)

            return f(*args, **kwargs)
        return wrapped
    return decorator


def run_with_timeout(func, *args, timeout=SYMPY_TIMEOUT, **kwargs):
    """Menjalankan kalkulasi berat pada worker thread dengan batasan timeout."""
    future = _executor.submit(func, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        raise TimeoutError(f"Kalkulasi membutuhkan waktu terlalu lama (timeout {timeout} detik). Coba sederhanakan bentuk fungsi.")


# =============================================================================
# SECTION 3: HELPER TERPADU REQUEST & ERROR HANDLER (BEBAS DUPLIKASI)
# =============================================================================
def _parse_math_request(hint="contoh: 2x^2 + 3x - 5, sin(x), atau sqrt(x)"):
    """
    Helper terpadu untuk membaca JSON, memvalidasi keamanan, dan mengurai ekspresi fungsi.
    Mengembalikan: (data, f_expr, var, expr_str, None) jika valid.
    Mengembalikan: (None, None, None, None, error_response) jika terjadi galat.
    """
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return None, None, None, None, (jsonify({'sukses': False, 'error': 'Data JSON tidak ditemukan atau kosong'}), 400)

    expr_str = str(data.get('fungsi', '')).strip()
    ok, msg = validate_fungsi(expr_str)
    if not ok:
        return None, None, None, None, (jsonify({'sukses': False, 'error': msg}), 400)

    f_expr = parse_function(expr_str)
    if f_expr is None:
        return None, None, None, None, (jsonify({
            'sukses': False,
            'error': f'Gagal memahami rumus fungsi. Pastikan penulisan benar, {hint}.'
        }), 400)

    var = detect_var(f_expr, get_requested_var(data))
    return data, f_expr, var, expr_str, None


def _attach_plot_to_result(res, plot_result, expr_str):
    """Menyertakan string ekspresi dan grafik (PNG & SVG) ke dictionary hasil kalkulasi."""
    res['fungsi_str'] = expr_str
    res['plot'], res['plot_svg'] = plot_result
    return res


def _handle_calc(calc_fn, label="kalkulus"):
    """Eksekutor kalkulasi terpadu dengan proteksi timeout, backpressure antrean, dan penanganan galat konsisten."""
    # Proteksi Backpressure / Queue Bounding: Jika worker queue menumpuk > 16 task, tolak segera dengan 503
    queue = getattr(_executor, '_work_queue', None)
    if queue is not None and queue.qsize() > 16:
        return jsonify({
            'sukses': False,
            'error': 'Server sedang memproses beban kalkulasi tinggi (antrean penuh). Silakan coba lagi dalam beberapa detik.'
        }), 503

    try:
        res = run_with_timeout(calc_fn, timeout=SYMPY_TIMEOUT)
        return jsonify(res)
    except TimeoutError as te:
        return jsonify({'sukses': False, 'error': str(te)}), 408
    except ValueError as ve:
        return jsonify({'sukses': False, 'error': str(ve)}), 400
    except Exception as e:
        logger.exception("Kesalahan pada %s: %s", label, str(e))
        return jsonify({'sukses': False, 'error': f'Terjadi kesalahan saat menghitung {label}: {str(e)}'}), 500


# =============================================================================
# SECTION 4: KEAMANAN HTTP
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
            return jsonify({'sukses': False, 'error': 'Format pengiriman harus application/json'}), 415


@app.errorhandler(413)
def too_large(e):
    return jsonify({'sukses': False, 'error': 'Ukuran data terlalu besar (maksimal 32KB)'}), 413


@app.errorhandler(429)
def ratelimited(e):
    return jsonify({'sukses': False, 'error': 'Terlalu banyak permintaan, coba beberapa saat lagi', 'retry_after': 30}), 429


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'sukses': False, 'error': 'Permintaan tidak valid atau data tidak lengkap'}), 400


# =============================================================================
# SECTION 5: API ROUTES
# =============================================================================
@app.route('/')
@rate_limit(api_limit=60, api_window=60, burst_limit=40, burst_window=10, global_limit=120, global_window=60)
def index():
    return render_template('index.html')


@app.route('/api/turunan', methods=['POST'])
@rate_limit(api_limit=35, api_window=60, burst_limit=25, burst_window=10, global_limit=70, global_window=60)
def turunan():
    data, f_expr, var, expr_str, err = _parse_math_request()
    if err:
        return err

    try:
        orde = int(data.get('orde', 1))
    except Exception:
        return jsonify({'sukses': False, 'error': 'Orde turunan harus berupa bilangan bulat antara 1 dan 10'}), 400

    if not 1 <= orde <= MAX_ORDE:
        return jsonify({'sukses': False, 'error': f'Orde turunan harus antara 1 dan {MAX_ORDE}'}), 400

    point_sym, _, pt_err = parse_numeric_or_symbolic(data.get('titik'))
    if pt_err:
        return jsonify({'sukses': False, 'error': f'Titik evaluasi tidak valid: {pt_err}'}), 400

    def do_work():
        res = compute_derivative(f_expr, var, orde, point_sym)
        plot_res = plot_derivative(f_expr, res.pop('derivative_expr'), expr_str, orde, point_sym, res.pop('evaluated_expr', None), var=var)
        return _attach_plot_to_result(res, plot_res, expr_str)

    return _handle_calc(do_work, "turunan")


@app.route('/api/integral', methods=['POST'])
@rate_limit(api_limit=30, api_window=60, burst_limit=20, burst_window=10, global_limit=60, global_window=60)
def integral():
    data, f_expr, var, expr_str, err = _parse_math_request(hint="contoh: x^2, sin(x), 1/(x^2 + 1), atau e^x")
    if err:
        return err

    bb = data.get('batas_bawah')
    ba = data.get('batas_atas')
    if (bb not in (None, '')) != (ba not in (None, '')):
        return jsonify({'sukses': False, 'error': 'Harap isi kedua batas (bawah dan atas) untuk menghitung integral tentu'}), 400

    bounds = {}
    for key, label in [('batas_bawah', 'bawah'), ('batas_atas', 'atas')]:
        raw_val = data.get(key)
        if raw_val not in (None, ''):
            sym, _, err_b = parse_numeric_or_symbolic(raw_val)
            if err_b:
                return jsonify({'sukses': False, 'error': f'Batas {label} tidak valid: {err_b}'}), 400
            bounds[key] = sym
        else:
            bounds[key] = None

    lb, ub = bounds['batas_bawah'], bounds['batas_atas']

    def do_work():
        res = compute_integral(f_expr, var, lb, ub)
        plot_res = plot_integral(f_expr, res.pop('indef_expr'), expr_str, lb=lb, ub=ub, def_val=res.pop('def_val', None), var=var)
        return _attach_plot_to_result(res, plot_res, expr_str)

    return _handle_calc(do_work, "integral")


@app.route('/api/limit', methods=['POST'])
@rate_limit(api_limit=35, api_window=60, burst_limit=25, burst_window=10, global_limit=70, global_window=60)
def limit():
    data, f_expr, var, expr_str, err = _parse_math_request(hint="contoh: sin(x)/x, (x^2 - 4)/(x - 2), atau 1/x")
    if err:
        return err

    arah = str(data.get('arah', '+-')).strip()
    if arah not in ('+', '-', '+-'):
        return jsonify({'sukses': False, 'error': 'Arah limit harus +, -, atau +-'}), 400

    point_sym, _, pt_err = parse_numeric_or_symbolic(data.get('titik', '0'), default=0)
    if pt_err:
        return jsonify({'sukses': False, 'error': f'Titik limit tidak valid: {pt_err}'}), 400

    def do_work():
        res = compute_limit(f_expr, var, point_sym, arah)
        plot_res = plot_limit(f_expr, expr_str, point_sym, res.pop('limit_val'), direction=arah, var=var)
        return _attach_plot_to_result(res, plot_res, expr_str)

    return _handle_calc(do_work, "limit")


@app.route('/api/natural-domain', methods=['POST'])
@rate_limit(api_limit=35, api_window=60, burst_limit=25, burst_window=10, global_limit=70, global_window=60)
def natural_domain():
    _, f_expr, var, expr_str, err = _parse_math_request(hint="contoh: 1/(x^2 - 4), sqrt(9 - x^2), atau ln(x)")
    if err:
        return err
    return _handle_calc(lambda: compute_natural_domain_and_analysis(f_expr, expr_str, var), "analisis fungsi")


@app.route('/api/matrix', methods=['POST'])
@rate_limit(api_limit=35, api_window=60, burst_limit=25, burst_window=10, global_limit=70, global_window=60)
def matrix():
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({'sukses': False, 'error': 'Data JSON tidak ditemukan atau kosong'}), 400

    op = str(data.get('operasi', 'tambah')).strip().lower()
    mA = data.get('matriks_a', {})
    mB = data.get('matriks_b', {})
    return _handle_calc(lambda: calc_matrix_logic(
        op=op,
        A_grid=mA.get('data', []),
        B_grid=mB.get('data', []) if mB else None,
        nameA=str(mA.get('nama', 'A')).strip()[:10] or 'A',
        nameB=str(mB.get('nama', 'B')).strip()[:10] or 'B',
        skalar_val=data.get('skalar', 1),
        obe_params=data.get('obe_params', {}),
        is_augmented=bool(data.get('is_augmented', False)),
        split_col=data.get('split_col', None)
    ), "matriks")


@app.route('/health')
@rate_limit(api_limit=80, api_window=60, burst_limit=40, burst_window=10, global_limit=150, global_window=60)
def health():
    return jsonify({"status": "ok"}), 200


# =============================================================================
# SECTION 6: SERVER RUNNER
# =============================================================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    if is_dev:
        logger.warning("Menjalankan dalam mode DEVELOPMENT (debug=True)")
    else:
        logger.info("Menjalankan dalam mode PRODUCTION (debug=False) — rate limit & security aktif")
    app.run(host='0.0.0.0', port=port, debug=is_dev, use_reloader=False)