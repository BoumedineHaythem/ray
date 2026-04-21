const CACHE_NAME = 'ev-fleet-cache-v3';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './storage.js',
    './data.js',
    './analytics.js',
    './supabase-config.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            })
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Never cache Supabase API calls
    if (e.request.url.includes('supabase.co')) return;
    
    e.respondWith(
        caches.match(e.request).then(cachedRes => {
            const fetchPromise = fetch(e.request).then(networkRes => {
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkRes.clone()));
                return networkRes;
            }).catch(() => cachedRes); // Fallback to cache if network fails
            return cachedRes || fetchPromise;
        })
    );
});