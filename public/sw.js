const SHELL_CACHE = 'vesna-probe-shell-v9';
const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/seekbar.js', '/modules/storage.js', '/modules/media-session.js', '/modules/offline.js',
];

function parseRangeHeader(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || size === 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength <= 0) return null;
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  if (start >= size) return null;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return end >= start ? { start, end } : null;
}

async function responseForCachedRequest(request, cached) {
  const range = request.headers.get('Range');
  if (range === null || cached.status !== 200) return cached;

  const bytes = new Uint8Array(await cached.arrayBuffer());
  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  const parsed = parseRangeHeader(range, bytes.byteLength);

  if (!parsed) {
    headers.set('Content-Range', `bytes */${bytes.byteLength}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }

  const { start, end } = parsed;
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

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
  event.respondWith(caches.match(event.request).then((cached) => {
    if (cached) return responseForCachedRequest(event.request, cached);
    if (event.request.mode === 'navigate') {
      return caches.match(new URL('/index.html', self.location.origin)).then((shell) => shell || fetch(event.request));
    }
    return fetch(event.request);
  }));
});
