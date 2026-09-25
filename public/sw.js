const CACHE = 'clearframe-shell-v3';
const SHELL = ['/', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE)
  .then(cache => cache.addAll(SHELL))
  .then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Navigation responses carry CSP headers. Always obtain those from the
  // network when available so a previous app shell cannot keep an obsolete
  // policy alive after a deployment.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
