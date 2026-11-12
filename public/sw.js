const SHELL_CACHE = 'vesna-app-shell-v6';
const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/api.js', '/modules/application.js', '/modules/input.js',
  '/modules/media-session.js', '/modules/player.js', '/modules/playback-bar.js', '/modules/prepared.js', '/modules/seekbar.js',
  '/modules/storage.js', '/modules/timing.js', '/modules/views.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_RESOURCES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((names) => Promise.all(names
      .filter((name) => name.startsWith('vesna-app-shell-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)))),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (SHELL_RESOURCES.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match(new URL('/index.html', self.location.origin).href)) || fetch(request);
    })());
  }
});
