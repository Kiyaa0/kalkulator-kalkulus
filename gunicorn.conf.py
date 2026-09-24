# Gunicorn hardened config — anti-DDoS / slowloris / resource exhaustion
# dipakai via: gunicorn app:app  atau  gunicorn -c gunicorn.conf.py app:app
import os
import multiprocessing

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = int(os.environ.get('WEB_CONCURRENCY', multiprocessing.cpu_count() * 2 + 1))
# Batasi worker agar tidak OOM saat SymPy berat
# Heroku/Render tier kecil: set WEB_CONCURRENCY=2
worker_class = "sync"
threads = 1

# Timeout: kill worker yang hang karena SymPy kompleks (> timeout). Sync dengan SYMPY_TIMEOUT di app.py (5s) + 25s buffer
timeout = 30
graceful_timeout = 10
keepalive = 2

# Anti slowloris: header/line limits
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190

# Recycle workers untuk hindari memori bocor (matplotlib/matplotlib SymPy)
max_requests = 1000
max_requests_jitter = 100

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Security: jangan expose server header versi
# (Gunicorn tidak expose header berlebihan by default)

# Forwarded headers dipercaya (ProxyFix di app.py sudah handle X-Forwarded-For/Proto)
forwarded_allow_ips = "*"
proxy_allow_ips = "*"

# Preload app untuk hemat memori
preload_app = True

def when_ready(server):
    server.log.info("Gunicorn hardened: workers=%s timeout=%s max_requests=%s", workers, timeout, max_requests)

def worker_abort(worker):
    worker.log.info("Worker aborted (timeout) — kemungkinan SymPy terlalu berat")
