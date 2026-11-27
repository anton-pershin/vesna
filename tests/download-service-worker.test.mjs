import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.example.test';
const INDEX_CACHE = 'vesna-offline-index-v1';
const INDEX_RESOURCE = '/__vesna_offline_library_index__';
const DOWNLOAD_HEADER = 'X-Vesna-Download';
const encoder = new TextEncoder();

function cacheKey(input) {
  return new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
}

class MemoryCache {
  constructor(name, storage) {
    this.name = name;
    this.storage = storage;
    this.values = new Map();
  }

  async put(input, response) {
    this.values.set(cacheKey(input), response.clone());
  }

  async match(input) {
    const key = cacheKey(input);
    this.storage.matches.push({ cacheName: this.name, key });
    return this.values.get(key)?.clone();
  }
}

class MemoryCaches {
  values = new Map();
  opened = [];
  matches = [];
  deleted = [];

  async open(name) {
    this.opened.push(name);
    if (!this.values.has(name)) this.values.set(name, new MemoryCache(name, this));
    return this.values.get(name);
  }

  async keys() { return [...this.values.keys()]; }

  async delete(name) {
    this.deleted.push(name);
    return this.values.delete(name);
  }

  resetReads() {
    this.opened = [];
    this.matches = [];
  }
}

function preparedResources(itemId = 'item-1', version = 'version-1') {
  const root = `/api/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(version)}`;
  return ['manifest', 'text', 'timings', 'audio'].map((artifact) => `${root}/${artifact}`);
}

function publishedRecord({ itemId = 'item-1', version = 'version-1', cacheName = 'vesna-item-item-1-version-1' } = {}) {
  return {
    format: 1,
    item: { id: itemId, version, state: 'ready' },
    version,
    cacheName,
    resources: preparedResources(itemId, version),
  };
}

async function publish(caches, records, { missingResource, bodies = new Map() } = {}) {
  for (const record of records) {
    const cache = await caches.open(record.cacheName);
    for (const resource of record.resources) {
      if (resource === missingResource) continue;
      const artifact = resource.split('/').at(-1);
      const body = bodies.get(resource) ?? `cached:${record.version}:${artifact}`;
      const length = typeof body === 'string' ? encoder.encode(body).byteLength : body.byteLength;
      await cache.put(new URL(resource, ORIGIN).href, new Response(body, {
        status: 200,
        headers: {
          'Content-Type': artifact === 'audio' ? 'audio/mpeg' : 'application/json',
          'Content-Length': String(length),
          'X-Download-Cache': record.cacheName,
        },
      }));
    }
  }
  const index = await caches.open(INDEX_CACHE);
  await index.put(new URL(INDEX_RESOURCE, ORIGIN).href, new Response(JSON.stringify({
    format: 1,
    items: records,
  }), { headers: { 'Content-Type': 'application/json' } }));
  caches.resetReads();
}

function createWorker(caches, networkFetch) {
  const listeners = new Map();
  const networkRequests = [];
  let claimed = false;
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: async () => {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: async (request) => {
      networkRequests.push(request);
      if (networkFetch) return networkFetch(request);
      return new Response('network');
    },
    URL,
    Request,
    Response,
    Headers,
  });
  new vm.Script(source, { filename: 'public/sw.js' }).runInContext(context);

  return {
    networkRequests,
    get claimed() { return claimed; },
    async dispatch(input, init) {
      const request = input instanceof Request ? input : new Request(new URL(input, ORIGIN), init);
      let pending;
      listeners.get('fetch')({
        request,
        respondWith(value) { pending = Promise.resolve(value); },
      });
      if (!pending) return { handled: false };
      return { handled: true, response: await pending };
    },
    async get(input, init) {
      const result = await this.dispatch(input, init);
      assert.equal(result.handled, true, 'prepared request is handled');
      return result.response;
    },
    async activate() {
      let pending;
      listeners.get('activate')({ waitUntil(value) { pending = Promise.resolve(value); } });
      await pending;
    },
  };
}

test('serves only resources published by the exact item version', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  await publish(caches, [record]);
  const worker = createWorker(caches, async () => {
    throw new Error('published resources must not use the network');
  });

  for (const resource of record.resources) {
    const response = await worker.get(resource);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Download-Cache'), record.cacheName);
    assert.equal(await response.text(), `cached:${record.version}:${resource.split('/').at(-1)}`);
  }
  assert.equal(worker.networkRequests.length, 0);
});

test('rejects a missing published resource instead of using another version or the network', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  const missingResource = record.resources[1];
  await publish(caches, [record], { missingResource });
  const worker = createWorker(caches);

  await assert.rejects(worker.get(missingResource), /published prepared resource is missing/);
  assert.equal(worker.networkRequests.length, 0);
});

test('uses the network when no exact publication exists and ignores orphan cached data', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  await publish(caches, [record]);
  const version2Text = preparedResources('item-1', 'version-2')[1];
  const orphan = await caches.open('vesna-item-item-1-version-2-orphan');
  await orphan.put(new URL(version2Text, ORIGIN).href, new Response('orphan version'));
  caches.resetReads();
  const worker = createWorker(caches, async () => new Response('network version 2'));

  const response = await worker.get(version2Text);
  assert.equal(await response.text(), 'network version 2');
  assert.equal(worker.networkRequests.length, 1);
  assert.ok(caches.matches.every(({ cacheName }) => cacheName === INDEX_CACHE));
});

test('download requests bypass publication lookup and always use the network', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  await publish(caches, [record]);
  const worker = createWorker(caches, async (request) => {
    assert.equal(request.headers.get(DOWNLOAD_HEADER), '1');
    return new Response('staged from network');
  });

  const response = await worker.get(record.resources[1], { headers: { [DOWNLOAD_HEADER]: '1' } });
  assert.equal(await response.text(), 'staged from network');
  assert.equal(worker.networkRequests.length, 1);
  assert.deepEqual(caches.opened, [], 'download staging does not open the offline index');
  assert.deepEqual(caches.matches, [], 'download staging does not read cached data');
});

test('cached audio supports full responses and satisfiable single ranges', async (t) => {
  const audioText = '0123456789abcdef';
  const audioBytes = encoder.encode(audioText);
  const caches = new MemoryCaches();
  const record = publishedRecord();
  const audioResource = record.resources[3];
  await publish(caches, [record], { bodies: new Map([[audioResource, audioBytes]]) });
  const worker = createWorker(caches, async () => {
    throw new Error('cached audio must not use the network');
  });

  const ordinary = await worker.get(audioResource);
  assert.equal(ordinary.status, 200);
  assert.equal(await ordinary.text(), audioText);
  assert.equal(ordinary.headers.get('Content-Range'), null);

  const cases = [
    { range: 'bytes=2-5', body: '2345', contentRange: 'bytes 2-5/16', length: '4' },
    { range: 'bytes=12-', body: 'cdef', contentRange: 'bytes 12-15/16', length: '4' },
    { range: 'bytes=-5', body: 'bcdef', contentRange: 'bytes 11-15/16', length: '5' },
    { range: 'bytes=14-99', body: 'ef', contentRange: 'bytes 14-15/16', length: '2' },
  ];
  for (const { range, body, contentRange, length } of cases) {
    await t.test(range, async () => {
      const response = await worker.get(audioResource, { headers: { Range: range } });
      assert.equal(response.status, 206);
      assert.equal(await response.text(), body);
      assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
      assert.equal(response.headers.get('X-Download-Cache'), record.cacheName);
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
      assert.equal(response.headers.get('Content-Range'), contentRange);
      assert.equal(response.headers.get('Content-Length'), length);
    });
  }
});

test('cached audio returns 416 for an unsatisfiable single range', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  const audioResource = record.resources[3];
  await publish(caches, [record], { bodies: new Map([[audioResource, encoder.encode('0123456789abcdef')]]) });
  const worker = createWorker(caches);

  const response = await worker.get(audioResource, { headers: { Range: 'bytes=16-' } });
  assert.equal(response.status, 416);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('Content-Range'), 'bytes */16');
  assert.equal(response.headers.get('Content-Length'), '0');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
});

test('cached audio ignores malformed and unsupported multiple ranges', async () => {
  const caches = new MemoryCaches();
  const record = publishedRecord();
  const audioResource = record.resources[3];
  await publish(caches, [record], { bodies: new Map([[audioResource, encoder.encode('0123456789abcdef')]]) });
  const worker = createWorker(caches);

  for (const range of ['bytes=0-1,4-5', 'items=0-1', 'bytes=invalid', 'bytes=7-6']) {
    const response = await worker.get(audioResource, { headers: { Range: range } });
    assert.equal(response.status, 200, range);
    assert.equal(await response.text(), '0123456789abcdef', range);
    assert.equal(response.headers.get('Content-Range'), null, range);
  }
});

test('activation deletes only old shell caches and preserves downloads and the current shell', async () => {
  const caches = new MemoryCaches();
  for (const name of [
    'vesna-app-shell-v9',
    'vesna-app-shell-v10',
    INDEX_CACHE,
    'vesna-item-item-1-version-1',
    'unrelated-cache',
  ]) {
    await caches.open(name);
  }
  const worker = createWorker(caches);
  await worker.activate();

  assert.equal(worker.claimed, true);
  assert.deepEqual(caches.deleted, ['vesna-app-shell-v9']);
  assert.deepEqual(await caches.keys(), [
    'vesna-app-shell-v10',
    INDEX_CACHE,
    'vesna-item-item-1-version-1',
    'unrelated-cache',
  ]);
});

test('auth, other APIs, cross-origin, and mutating requests never read the offline index', async () => {
  const caches = new MemoryCaches();
  const worker = createWorker(caches);
  const paths = [
    '/api/auth/session',
    '/api/items',
    '/api/items/item-1',
    '/api/items/item-1/source',
    '/api/build',
  ];
  for (const path of paths) {
    const result = await worker.dispatch(path, { headers: { [DOWNLOAD_HEADER]: '1' } });
    assert.equal(result.handled, false, path);
  }
  assert.equal((await worker.dispatch(preparedResources()[1], { method: 'POST' })).handled, false);
  assert.equal((await worker.dispatch(new Request(`${ORIGIN.replace('app.', 'other.')}${preparedResources()[3]}`))).handled, false);
  assert.deepEqual(caches.opened, []);
  assert.deepEqual(caches.matches, []);
  assert.equal(worker.networkRequests.length, 0);
});
