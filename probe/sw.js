const SHELL_CACHE = 'vesna-probe-shell-v15';
const FIXTURE_POINTER_CACHE = 'vesna-probe-fixture-pointer-v1';
const FIXTURE_POINTER_RESOURCE = '/__vesna_offline_fixture_pointer__';
const FIXTURE_DOWNLOAD_HEADER = 'X-Vesna-Fixture-Download';
const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/seekbar.js', '/modules/storage.js', '/modules/media-session.js',
  '/probe-modules/offline.js', '/probe-modules/offline-store.js', '/probe-modules/fixture-download.js',
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

async function readPublishedFixture() {
  const pointerCache = await caches.open(FIXTURE_POINTER_CACHE);
  const pointerUrl = new URL(FIXTURE_POINTER_RESOURCE, self.location.origin).href;
  const pointerResponse = await pointerCache.match(pointerUrl);
  if (!pointerResponse) return null;
  const record = await pointerResponse.json();
  if (!record || typeof record.version !== 'string' ||
      typeof record.cacheName !== 'string' || !record.cacheName ||
      !Array.isArray(record.resources)) {
    throw new Error('invalid offline fixture pointer');
  }
  return record;
}

async function matchPublishedFixture(request) {
  const path = new URL(request.url).pathname;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await readPublishedFixture();
    if (!record) return undefined;
    const isFixtureResource = record.resources.some((resource) => (
      typeof resource === 'string' && new URL(resource, self.location.origin).pathname === path
    ));
    if (!isFixtureResource) return undefined;
    const fixtureCache = await caches.open(record.cacheName);
    const cached = await fixtureCache.match(request);
    if (cached) return cached;
    const latest = await readPublishedFixture();
    if (latest?.cacheName === record.cacheName && latest.version === record.version) {
      throw new Error(`published fixture resource is missing: ${path}`);
    }
  }
  throw new Error('published fixture changed repeatedly during a request');
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
  if (event.request.headers.get(FIXTURE_DOWNLOAD_HEADER) === '1') {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async () => {
    const shellCache = await caches.open(SHELL_CACHE);
    const shell = await shellCache.match(event.request);
    if (shell) return responseForCachedRequest(event.request, shell);
    const fixture = await matchPublishedFixture(event.request);
    if (fixture) return responseForCachedRequest(event.request, fixture);
    if (event.request.mode === 'navigate') {
      const fallback = await shellCache.match(new URL('/index.html', self.location.origin).href);
      if (fallback) return fallback;
    }
    return fetch(event.request);
  })());
});
