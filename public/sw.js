const CACHE = 'vesna-probe-fixture-v1';
const SHELL = [
  '/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json', '/fixtures/audio/fixture.mp3',
  '/modules/timing.js', '/modules/player.js', '/modules/storage.js', '/modules/media-session.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
