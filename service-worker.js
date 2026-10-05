const CACHE_NAME = 'hw-scanner-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/match.js',
  './js/app.js',
  './vendor/tesseract.min.js',
  './vendor/worker.min.js',
  './vendor/tesseract-core-lstm.js',
  './vendor/tesseract-core-lstm.wasm',
  './vendor/eng.traineddata.gz',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Large, never-changing OCR engine files: cache-first (no point re-fetching megabytes
// of wasm/traineddata every time, and they must stay usable fully offline).
const CACHE_FIRST = /\/vendor\/|\/icons\//;

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isCacheFirst = CACHE_FIRST.test(event.request.url);

  if (isCacheFirst) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((resp) => {
        if (resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      }))
    );
    return;
  }

  // App shell (html/css/js): network-first, so a new deploy is picked up on the
  // very next load instead of being stuck behind a stale cached copy. Falls back
  // to cache when offline.
  event.respondWith(
    fetch(event.request).then((resp) => {
      if (resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return resp;
    }).catch(() => caches.match(event.request))
  );
});
