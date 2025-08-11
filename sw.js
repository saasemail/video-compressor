// sw.js - simple service worker for Video Compressor PWA
const CACHE_VERSION = 'v1';
const CACHE_NAME = `video-compressor-${CACHE_VERSION}`;

// List of core assets that make up the application. When adding new files
// (e.g. additional icons or scripts) include them here so they are cached
// during the install step. The ffmpeg.wasm file will be cached at runtime.
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/licensing.js',
  '/presets.json',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle GET requests for same-origin assets.
  if (event.request.method !== 'GET' || url.origin !== location.origin) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Save new resources in cache for subsequent loads.
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});