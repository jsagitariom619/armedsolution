// v9: simulaciones elípticas de circunferencias y foto lateral opcional.
const CACHE = 'medidor-ar-v9';
const ASSETS = ['./', './index.html', './styles.css?v=9', './app.js?v=4', './circumference.js?v=9', './body.js?v=9', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  const url = new URL(event.request.url);
  const fresh = event.request.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname);
  if (!fresh) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
    return;
  }
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request,copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(event.request) ||
        (event.request.mode === 'navigate' ? await cache.match('./index.html') : null) ||
        Response.error();
    })
  );
});
