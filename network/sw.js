/* Rootwork service worker: the app shell is cached so it opens with no signal.
   Bump CACHE when the shell changes — old caches are dropped on activate. */
var CACHE = 'rootwork-v3';
var SHELL = [
  './', './index.html', './network.css', './app.js', './sync.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                 // sync writes never touch the cache
  if (url.origin !== location.origin) return;             // Supabase and fonts go straight to the network

  // serve from cache at once, refresh it in the background
  e.respondWith(caches.match(e.request).then(function (hit) {
    var live = fetch(e.request).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || live;
  }));
});
