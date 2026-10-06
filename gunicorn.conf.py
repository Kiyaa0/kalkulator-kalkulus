# Gunicorn hardened config — anti-DDoS / slowloris / resource exhaustion
# dipakai via: gunicorn app:app  atau  gunicorn -c gunicorn.conf.py app:app
import os
import multiprocessing

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = int(os.environ.get('WEB_CONCURRENCY', max(2, min(4, multiprocessing.cpu_count()))))

# Gunakan gthread (threaded worker) agar tidak mudah hang akibat koneksi lambat / Slowloris
worker_class = "gthread"
threads = int(os.environ.get('GUNICORN_THREADS', '4'))

# Timeout: kill worker yang hang karena SymPy kompleks (> timeout)
timeout = 25
graceful_timeout = 5
keepalive = 2

# Anti slowloris: header/line limits
limit_request_line = 4094
limit_request_fields = 100
limit_request_field_size = 8190

# Recycle workers untuk hindari memori bocor (matplotlib/SymPy)
max_requests = 1000
max_requests_jitter = 100

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Preload app untuk hemat memori
preload_app = True

def when_ready(server):
    server.log.info("Gunicorn hardened: workers=%s threads=%s timeout=%s max_requests=%s", workers, threads, timeout, max_requests)

def worker_abort(worker):
    worker.log.warning("Worker aborted (timeout) — kemungkinan kalkulasi berat melebihi batas waktu")
