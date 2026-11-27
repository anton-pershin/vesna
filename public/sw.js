const SHELL_CACHE = 'vesna-app-shell-v10';
const DOWNLOAD_INDEX_CACHE = 'vesna-offline-index-v1';
const DOWNLOAD_INDEX_RESOURCE = '/__vesna_offline_library_index__';
const DOWNLOAD_HEADER = 'X-Vesna-Download';
const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/api.js', '/modules/application.js', '/modules/downloads.js', '/modules/input.js',
  '/modules/media-session.js', '/modules/player.js', '/modules/playback-bar.js', '/modules/prepared.js', '/modules/seekbar.js',
  '/modules/storage.js', '/modules/timing.js', '/modules/views.js',
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

async function responseForCachedAudio(request, cached) {
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

function preparedResource(url) {
  const match = /^\/api\/items\/([^/]+)\/versions\/([^/]+)\/(manifest|text|timings|audio)$/.exec(url.pathname);
  if (!match) return null;
  try {
    return {
      itemId: decodeURIComponent(match[1]),
      version: decodeURIComponent(match[2]),
      kind: match[3],
      path: url.pathname,
    };
  } catch {
    return null;
  }
}

async function readDownloadIndex() {
  const cache = await caches.open(DOWNLOAD_INDEX_CACHE);
  const indexUrl = new URL(DOWNLOAD_INDEX_RESOURCE, self.location.origin).href;
  const response = await cache.match(indexUrl);
  if (!response) return null;
  const index = await response.json();
  if (!index || index.format !== 1 || !Array.isArray(index.items)) {
    throw new Error('invalid offline library index');
  }
  return index.items;
}

function findPublishedRecord(items, resource) {
  return items?.find((record) => {
    if (
      !record || record.format !== 1 || record.item?.id !== resource.itemId ||
      record.version !== resource.version || typeof record.cacheName !== 'string' ||
      !record.cacheName || !Array.isArray(record.resources)
    ) {
      return false;
    }
    return record.resources.some((candidate) => {
      if (typeof candidate !== 'string' || !candidate) return false;
      try {
        const url = new URL(candidate, self.location.origin);
        return url.origin === self.location.origin && url.pathname === resource.path;
      } catch {
        return false;
      }
    });
  });
}

async function matchPublishedDownload(request, resource) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const items = await readDownloadIndex();
    const record = findPublishedRecord(items, resource);
    if (!record) return undefined;

    const cache = await caches.open(record.cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const latestItems = await readDownloadIndex();
    const latest = findPublishedRecord(latestItems, resource);
    if (latest?.cacheName === record.cacheName) {
      throw new Error(`published prepared resource is missing: ${resource.path}`);
    }
  }
  throw new Error('published prepared resource changed repeatedly during a request');
}

async function networkFirstShell(request, cacheKey) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        // A cache-write failure must not replace a successful online response.
      }
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(
        SHELL_RESOURCES.map((resource) => new Request(
          new URL(resource, self.location.origin),
          { cache: 'reload' },
        )),
      ))
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
  if (url.origin !== self.location.origin) return;

  if (SHELL_RESOURCES.includes(url.pathname)) {
    event.respondWith(networkFirstShell(request, request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const resource = preparedResource(url);
    if (!resource) return;
    if (request.headers.get(DOWNLOAD_HEADER) === '1') {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith((async () => {
      const cached = await matchPublishedDownload(request, resource);
      if (!cached) return fetch(request);
      if (resource.kind !== 'audio') return cached;
      return responseForCachedAudio(request, cached);
    })());
    return;
  }

  if (request.mode === 'navigate') {
    const index = new URL('/index.html', self.location.origin).href;
    event.respondWith(networkFirstShell(request, index));
  }
});
