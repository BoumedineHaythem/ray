// هذا الكود سيقوم بحذف الذاكرة المؤقتة القديمة وإلغاء تثبيت نفسه فوراً
self.addEventListener('install', (e) => {
    self.skipWaiting(); // يجبر المتصفح على التحديث فوراً
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Deleting old cache:', cacheName);
                    return caches.delete(cacheName); // حذف الملفات القديمة
                })
            );
        }).then(() => {
            self.registration.unregister(); // تدمير الـ Service Worker
        })
    );
});