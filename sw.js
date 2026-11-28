// sw.js — 离线缓存（cache-first）。改任何静态资源后必须升 CACHE 版本号
const CACHE = 'slr-v34';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/landing.css',
  './js/store.js',
  './js/cards.js',
  './js/xlsx.js',
  './js/terms.js',
  './js/calendar.js',
  './js/dialog.js',
  './js/stats.js',
  './js/settings.js',
  './js/install.js',
  './js/landing.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/splash-1170x2532.png',
  './icons/splash-1179x2556.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) => hit || fetch(e.request).catch(() => {
        // 离线且缓存未命中：导航请求回退到缓存的首页
        return e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error();
      })
    )
  );
});
