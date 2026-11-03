const SHELL_CACHE = 'vesna-probe-shell-v11';
const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/seekbar.js', '/modules/storage.js', '/modules/media-session.js', '/modules/offline.js',
];

function parseSingleRange(value, size) {
  const match = /^(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  if (size === 0) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength <= 0) return null;
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : null;
  if (requestedEnd !== null && requestedEnd < start) return undefined;
  if (start >= size) return null;
  const end = requestedEnd === null ? size - 1 : Math.min(requestedEnd, size - 1);
  return { start, end };
}

function parseRangeHeader(header, size) {
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (!match) return undefined;
  const values = match[1].split(',');
  const satisfiable = [];
  for (const value of values) {
    const parsed = parseSingleRange(value, size);
    if (parsed === undefined) return undefined;
    if (parsed !== null) satisfiable.push(parsed);
  }
  if (satisfiable.length === 0) return null;
  if (values.length > 1) return undefined;
  return satisfiable[0];
}

async function responseForCachedRequest(request, cached) {
  const range = request.headers.get('Range');
  if (range === null || cached.status !== 200) return cached;

  const bytes = new Uint8Array(await cached.clone().arrayBuffer());
  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  const parsed = parseRangeHeader(range, bytes.byteLength);

  if (parsed === undefined) return cached;
  if (parsed === null) {
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
