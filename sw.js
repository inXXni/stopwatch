// 全部资源都是静态的，用 cache-first。改动文件后记得把 CACHE 版本号加一。
const CACHE = 'slap-stopwatch-v13';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './display.js',
  './timer-core.js',
  './manifest.json',
  './manifest-green.json',
  './manifest-pk.json',
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
  // 忽略地址参数：?pk、?green 打开的都是同一个 index.html，参数由页面自己读取。
  // 不忽略的话，带参数的地址在缓存里查不到，断网时就打不开。
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(event.request))
  );
});
