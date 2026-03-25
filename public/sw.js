// Basic Service Worker for PWA installation
self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  // Pass through for now
  e.respondWith(fetch(e.request));
});
