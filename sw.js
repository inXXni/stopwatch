// 全部资源都是静态的，用 cache-first。改动文件后记得把 CACHE 版本号加一。
const CACHE = 'slap-stopwatch-v4';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './timer-core.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './fonts/DSEG7Classic-Bold.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
