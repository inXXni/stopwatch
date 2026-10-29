// 全部资源都是静态的，用 cache-first。改动文件后记得把 CACHE 版本号加一。
const CACHE = 'slap-stopwatch-v21';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './display.js',
  './timer-core.js',
  './beep.js',
  './slam.js',
  './hit.js',
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
      // 绕过浏览器的 HTTP 缓存，直接向服务器要最新文件。否则新版安装时可能拿到浏览器缓存里的
      // 旧 index.html、app.js（本地服务不写缓存头，浏览器按修改时间估算新鲜期；
      // GitHub Pages 缓存 10 分钟），新缓存里混进旧文件，刷新多少次都还是旧版
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
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
