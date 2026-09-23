/* CalcKu Service Worker - offline PWA + caching strategi.
 *
 * Naikkan VERSION saat deploy perubahan pada file statis (main.js, style.css,
 * index.html) agar cache lama dibersihkan dan asset baru di-precache ulang.
 */
const VERSION = 'v9-download';
const CACHE_STATIC = 'calcku-static-' + VERSION;
const CACHE_RUNTIME = 'calcku-runtime-' + VERSION;
// efisien: cuma cache yang beneran ada (index.html inline, no css/js terpisah)
const CORE_ASSETS = [
    '/',
    '/static/manifest.json',
    '/static/icon-192.png',
    '/static/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_STATIC)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys
                .filter((k) => !k.startsWith(CACHE_STATIC) && !k.startsWith(CACHE_RUNTIME))
                .map((k) => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin !== self.location.origin) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }
    if (url.pathname.startsWith('/api/')) return;
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req));
        return;
    }
    event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.ok) {
        const cache = await caches.open(CACHE_RUNTIME);
        cache.put(req, res.clone());
    }
    return res;
}

async function networkFirst(req) {
    try {
        const res = await fetch(req);
        if (res && res.ok) {
            const cache = await caches.open(CACHE_RUNTIME);
            cache.put(req, res.clone());
        }
        return res;
    } catch (err) {
        const cached = await caches.match(req);
        return cached || Response.error();
    }
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE_RUNTIME);
    const cached = await cache.match(req);
    const network = fetch(req).then(async (res) => {
        if (res && res.ok) await cache.put(req, res.clone());
        return res;
    }).catch(() => cached);
    return cached || network;
}
