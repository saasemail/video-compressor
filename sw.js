// sw.js — offline cache (no external CDNs)
const CACHE = 'qrtoolkit-lite-v1';

const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  // vendor libs (local)
  './vendor/qrcode.min.js',
  './vendor/jspdf.umd.min.js'
];

self.addEventListener('install', (e)=>{
  e.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k=> (k===CACHE?null:caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // Only cache same-origin GET
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async ()=>{
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    if (cached) return cached;
    try{
      const res = await fetch(e.request);
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }catch{
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
