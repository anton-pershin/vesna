const SHELL_CACHE = 'vesna-probe-shell-v2';
const SHELL_RESOURCES = [
  '/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/storage.js', '/modules/media-session.js', '/modules/offline.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_RESOURCES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((names) => Promise.all(names
      .filter((name) => name.startsWith('vesna-probe-shell-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)))),
  ]));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
