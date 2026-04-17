const CACHE_NAME = 'ev-fleet-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './data.js',
    './storage.js',
    './analytics.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js'
    // Note: User must supply images/car1.jpg, images/scooter1.jpg, and icons locally
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching App Shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                // Network fallback
                return fetch(event.request).catch(() => {
                    // Provide offline fallback for specific routes if needed
                });
            })
    );
});