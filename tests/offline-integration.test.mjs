import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  FIXTURE_DOWNLOAD_HEADER,
  FIXTURE_LOCK,
  FIXTURE_POINTER_CACHE,
  FIXTURE_POINTER_RESOURCE,
  FIXTURE_RESOURCES,
  readOfflineFixturePointer,
  replaceOfflineFixture,
  restoreOfflineFixturePointer,
} from '../public/modules/offline.js';
import { OfflineFixtureStore } from '../public/modules/storage.js';

const ORIGIN = 'https://offline-integration.test';
const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

function cacheKey(request) {
  return new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
}

class NamedCache {
  constructor(name) {
    this.name = name;
    this.values = new Map();
  }

  async put(request, response) {
    this.values.set(cacheKey(request), response.clone());
  }

  async match(request) {
    // Cache keys contain the URL, not request headers such as Range.
    return this.values.get(cacheKey(request))?.clone();
  }

  async delete(request) {
    return this.values.delete(cacheKey(request));
  }
}

class NamedCacheStorage {
  values = new Map();
  failedDeletes = new Set();
  deleteAttempts = [];

  async open(name) {
    if (!this.values.has(name)) this.values.set(name, new NamedCache(name));
    return this.values.get(name);
  }

  async delete(name) {
    this.deleteAttempts.push(name);
    if (this.failedDeletes.has(name)) throw new Error(`cannot delete ${name}`);
    return this.values.delete(name);
  }

  async keys() { return [...this.values.keys()]; }
}

function createWorker(caches, networkFetch) {
  const listeners = new Map();
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: networkFetch,
    Request,
    Response,
    Headers,
    URL,
  });
  new vm.Script(workerSource, { filename: 'public/sw.js' }).runInContext(context);

  return {
    async get(input, init) {
      const request = input instanceof Request
        ? input
        : new Request(new URL(input, ORIGIN), init);
      let pendingResponse;
      listeners.get('fetch')({
        request,
        respondWith(response) { pendingResponse = Promise.resolve(response); },
      });
      assert.ok(pendingResponse, 'worker handles the GET request');
      return pendingResponse;
    },
  };
}

function createWorld(onDownload) {
  const cachesApi = new NamedCacheStorage();
  const fixtureStore = new OfflineFixtureStore(new MemoryStorage());
  const networkFetch = async (request) => {
    if (request.headers.get(FIXTURE_DOWNLOAD_HEADER) !== '1') {
      throw new Error(`offline network fallback: ${request.url}`);
    }
    return onDownload(request);
  };
  const worker = createWorker(cachesApi, networkFetch);
  return { cachesApi, fixtureStore, worker };
}

function makeFixture(version, { textVersion = version, audioSha256 } = {}) {
  const audio = encoder.encode(`audio:${version}:0123456789`);
  const audioSha = audioSha256 ?? createHash('sha256').update(audio).digest('hex');
  return {
    version,
    bodies: new Map([
      ['/fixtures/manifest.json', JSON.stringify({
        version,
        audio: 'audio/fixture.mp3',
        audio_bytes: audio.byteLength,
        audio_sha256: audioSha,
      })],
      ['/fixtures/text.json', JSON.stringify({ version: textVersion, text: `${version} text` })],
      ['/fixtures/timings.json', JSON.stringify({ version, timings: [[0, 1]] })],
      ['/fixtures/audio/fixture.mp3', audio],
    ]),
  };
}

function fixtureResponse(fixture, url) {
  const body = fixture.bodies.get(url);
  assert.ok(body !== undefined, `fixture contains ${url}`);
  return new Response(body, {
    headers: {
      'Content-Type': url.endsWith('.mp3') ? 'audio/mpeg' : 'application/json',
      'X-Fixture-Version': fixture.version,
    },
  });
}

function bodyText(body) {
  return typeof body === 'string' ? body : decoder.decode(body);
}

async function assertWorkerFixture(worker, version) {
  const expected = makeFixture(version);
  for (const url of FIXTURE_RESOURCES) {
    const response = await worker.get(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Fixture-Version'), version);
    assert.equal(await response.text(), bodyText(expected.bodies.get(url)), url);
  }
}

function downloadThroughWorker(worker, replacementVersion) {
  return (url) => worker.get(url, {
    headers: {
      [FIXTURE_DOWNLOAD_HEADER]: '1',
      ...(replacementVersion ? { 'X-Test-Replacement': replacementVersion } : {}),
    },
  });
}

async function seedPublishedFixture(cachesApi, fixtureStore, version = 'v1') {
  const cacheName = `fixture-${version}`;
  const fixture = makeFixture(version);
  const cache = await cachesApi.open(cacheName);
  for (const url of FIXTURE_RESOURCES) {
    await cache.put(new URL(url, ORIGIN).href, fixtureResponse(fixture, url));
  }
  fixtureStore.publish({ version, resources: FIXTURE_RESOURCES, cacheName });
  const pointer = await restoreOfflineFixturePointer({
    cachesApi,
    fixtureStore,
    origin: ORIGIN,
  });
  assert.deepEqual(pointer, { version, resources: FIXTURE_RESOURCES, cacheName });
  return { cacheName, pointer };
}

async function replaceThroughWorker({
  worker,
  fixtureStore,
  cachesApi,
  version,
  cacheName = `fixture-${version}`,
}) {
  return replaceOfflineFixture({
    version,
    resources: FIXTURE_RESOURCES,
    cacheName,
    fetchImpl: downloadThroughWorker(worker, version),
    cachesApi,
    fixtureStore,
    origin: ORIGIN,
  });
}

test('worker-dispatched replacement downloads all resources and never serves orphan content', async () => {
  const v2 = makeFixture('v2');
  const downloads = [];
  const { cachesApi, fixtureStore, worker } = createWorld(async (request) => {
    const path = new URL(request.url).pathname;
    downloads.push(path);
    return fixtureResponse(v2, path);
  });
  const v1 = await seedPublishedFixture(cachesApi, fixtureStore);
  const orphan = await cachesApi.open('orphan-partial');
  await orphan.put(
    new URL('/fixtures/text.json', ORIGIN).href,
    new Response('{"version":"orphan","text":"must not be served"}', {
      headers: { 'X-Fixture-Version': 'orphan' },
    }),
  );

  await assertWorkerFixture(worker, 'v1');
  const published = await replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' });

  assert.deepEqual(downloads, FIXTURE_RESOURCES);
  assert.deepEqual(fixtureStore.read(), published);
  assert.deepEqual(await readOfflineFixturePointer(cachesApi, ORIGIN), {
    version: 'v2',
    resources: FIXTURE_RESOURCES,
    cacheName: published.cacheName,
  });
  assert.deepEqual(cachesApi.deleteAttempts, [v1.cacheName]);
  await assertWorkerFixture(worker, 'v2');
  assert.deepEqual(downloads, FIXTURE_RESOURCES, 'ordinary cached reads do not use the network');
});

test('old-cache deletion failure does not prevent publication or worker reads', async () => {
  const v2 = makeFixture('v2');
  const { cachesApi, fixtureStore, worker } = createWorld(async (request) => (
    fixtureResponse(v2, new URL(request.url).pathname)
  ));
  const v1 = await seedPublishedFixture(cachesApi, fixtureStore);
  cachesApi.failedDeletes.add(v1.cacheName);

  const published = await replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' });

  assert.equal(published.ready, true);
  assert.deepEqual(cachesApi.deleteAttempts, [v1.cacheName]);
  assert.ok((await cachesApi.keys()).includes(v1.cacheName), 'old cache remains for later cleanup');
  assert.deepEqual(fixtureStore.read(), published);
  await assertWorkerFixture(worker, 'v2');
});

test('staged validation failures preserve the previous pointer, store, and worker fixture', async (t) => {
  const cases = [
    {
      name: 'metadata version mismatch',
      overrides: { textVersion: 'not-v2' },
      error: /fixture version mismatch: \/fixtures\/text\.json/,
    },
    {
      name: 'audio digest mismatch',
      overrides: { audioSha256: '0'.repeat(64) },
      error: /fixture audio digest does not match/,
    },
  ];

  for (const { name, overrides, error } of cases) {
    await t.test(name, async () => {
      const v2 = makeFixture('v2', overrides);
      const { cachesApi, fixtureStore, worker } = createWorld(async (request) => (
        fixtureResponse(v2, new URL(request.url).pathname)
      ));
      const v1 = await seedPublishedFixture(cachesApi, fixtureStore);
      const previousStore = fixtureStore.read();

      await assert.rejects(
        replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' }),
        error,
      );

      assert.deepEqual(fixtureStore.read(), previousStore);
      assert.deepEqual(await readOfflineFixturePointer(cachesApi, ORIGIN), v1.pointer);
      assert.ok((await cachesApi.keys()).includes(v1.cacheName));
      assert.ok(!(await cachesApi.keys()).includes('fixture-v2'), 'failed staging cache is removed');
      await assertWorkerFixture(worker, 'v1');
    });
  }
});

test('concurrent replacements on one store are serialized and a later failure cannot roll back the first', async () => {
  const fixtures = {
    v2: makeFixture('v2'),
    v3: makeFixture('v3', { textVersion: 'not-v3' }),
  };
  const calls = [];
  let activeDownloads = 0;
  let maxActiveDownloads = 0;
  let notifyFirstStarted;
  const firstStarted = new Promise((resolve) => { notifyFirstStarted = resolve; });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const { cachesApi, fixtureStore, worker } = createWorld(async (request) => {
    const version = request.headers.get('X-Test-Replacement');
    const path = new URL(request.url).pathname;
    calls.push(`${version}:${path}`);
    activeDownloads += 1;
    maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
    try {
      if (version === 'v2' && path === FIXTURE_RESOURCES[0]) {
        notifyFirstStarted();
        await firstGate;
      }
      return fixtureResponse(fixtures[version], path);
    } finally {
      activeDownloads -= 1;
    }
  });
  await seedPublishedFixture(cachesApi, fixtureStore);

  const first = replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' });
  await firstStarted;
  const second = replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v3' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.startsWith('v3:')).length, 0, 'second download is queued');

  releaseFirst();
  const firstPublished = await first;
  await assert.rejects(second, /fixture version mismatch: \/fixtures\/text\.json/);

  assert.equal(maxActiveDownloads, 1);
  assert.deepEqual(calls, [
    ...FIXTURE_RESOURCES.map((url) => `v2:${url}`),
    ...FIXTURE_RESOURCES.map((url) => `v3:${url}`),
  ]);
  assert.deepEqual(fixtureStore.read(), firstPublished);
  assert.deepEqual(await readOfflineFixturePointer(cachesApi, ORIGIN), {
    version: 'v2',
    resources: FIXTURE_RESOURCES,
    cacheName: firstPublished.cacheName,
  });
  await assertWorkerFixture(worker, 'v2');
});

test('publication rollback uses the authoritative pointer when localStorage diverges', async () => {
  const v2 = makeFixture('v2');
  const { cachesApi, fixtureStore, worker } = createWorld(async (request) => (
    fixtureResponse(v2, new URL(request.url).pathname)
  ));
  const v1 = await seedPublishedFixture(cachesApi, fixtureStore);
  const pointerCache = await cachesApi.open(FIXTURE_POINTER_CACHE);
  const originalPointerPut = pointerCache.put.bind(pointerCache);
  const pointerWrites = [];
  pointerCache.put = async (request, response) => {
    const record = await response.clone().json();
    pointerWrites.push(record.version);
    await originalPointerPut(request, response);
  };

  fixtureStore.read = () => null;
  const quotaError = new Error('fixture storage quota exceeded');
  quotaError.name = 'QuotaExceededError';
  fixtureStore.publish = (record) => {
    assert.equal(record.version, 'v2');
    assert.deepEqual(pointerWrites, ['v2'], 'the v2 pointer write precedes localStorage publication');
    throw quotaError;
  };

  await assert.rejects(
    replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' }),
    (error) => {
      assert.equal(error, quotaError);
      return true;
    },
  );

  assert.deepEqual(pointerWrites, ['v2', 'v1'], 'the failed v2 pointer is rolled back');
  assert.deepEqual(await readOfflineFixturePointer(cachesApi, ORIGIN), v1.pointer);
  assert.ok((await cachesApi.keys()).includes(v1.cacheName));
  assert.ok(!(await cachesApi.keys()).includes('fixture-v2'), 'failed v2 staging cache is removed');
  await assertWorkerFixture(worker, 'v1');
});

test('Web Lock serializes legacy migration and replacement across store instances', async (t) => {
  const storage = new MemoryStorage();
  const firstStore = new OfflineFixtureStore(storage);
  const secondStore = new OfflineFixtureStore(storage);
  const cachesApi = new NamedCacheStorage();
  const v2 = makeFixture('v2');
  const downloads = [];
  const worker = createWorker(cachesApi, async (request) => {
    const path = new URL(request.url).pathname;
    downloads.push(path);
    return fixtureResponse(v2, path);
  });
  const v1 = await seedPublishedFixture(cachesApi, firstStore);
  const pointerCache = await cachesApi.open(FIXTURE_POINTER_CACHE);
  await pointerCache.delete(new URL(FIXTURE_POINTER_RESOURCE, ORIGIN).href);

  const originalPointerPut = pointerCache.put.bind(pointerCache);
  let notifyMigrationPointerWrite;
  const migrationPointerWrite = new Promise((resolve) => { notifyMigrationPointerWrite = resolve; });
  let releaseMigrationPointerWrite;
  const migrationGate = new Promise((resolve) => { releaseMigrationPointerWrite = resolve; });
  let migrationWasGated = false;
  pointerCache.put = async (request, response) => {
    const record = await response.clone().json();
    if (record.version === 'v1' && !migrationWasGated) {
      migrationWasGated = true;
      notifyMigrationPointerWrite();
      await migrationGate;
    }
    await originalPointerPut(request, response);
  };

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
  });
  const lockRequests = [];
  let activeCriticalSections = 0;
  let maxActiveCriticalSections = 0;
  let lockQueue = Promise.resolve();
  const locks = {
    request(name, options, operation) {
      lockRequests.push({ name, options });
      const run = lockQueue.then(async () => {
        activeCriticalSections += 1;
        maxActiveCriticalSections = Math.max(maxActiveCriticalSections, activeCriticalSections);
        try {
          return await operation();
        } finally {
          activeCriticalSections -= 1;
        }
      });
      lockQueue = run.catch(() => {});
      return run;
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { locks },
  });

  const migration = restoreOfflineFixturePointer({
    cachesApi,
    fixtureStore: firstStore,
    origin: ORIGIN,
  });
  await migrationPointerWrite;
  const replacement = replaceThroughWorker({
    worker,
    fixtureStore: secondStore,
    cachesApi,
    version: 'v2',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(downloads, [], 'replacement waits for the other store\'s migration');

  releaseMigrationPointerWrite();
  const [migrated, published] = await Promise.all([migration, replacement]);

  assert.deepEqual(migrated, v1.pointer);
  assert.deepEqual(lockRequests, [
    { name: FIXTURE_LOCK, options: { mode: 'exclusive' } },
    { name: FIXTURE_LOCK, options: { mode: 'exclusive' } },
  ]);
  assert.equal(maxActiveCriticalSections, 1);
  assert.deepEqual(downloads, FIXTURE_RESOURCES);
  assert.deepEqual(secondStore.read(), published);
  assert.deepEqual(await readOfflineFixturePointer(cachesApi, ORIGIN), {
    version: 'v2',
    resources: FIXTURE_RESOURCES,
    cacheName: published.cacheName,
  });
  await assertWorkerFixture(worker, 'v2');
});

test('worker retries with the new generation when the old cache disappears mid-read', async () => {
  const v2 = makeFixture('v2');
  const { cachesApi, fixtureStore, worker } = createWorld(async (request) => (
    fixtureResponse(v2, new URL(request.url).pathname)
  ));
  const v1 = await seedPublishedFixture(cachesApi, fixtureStore);
  const originalOpen = cachesApi.open.bind(cachesApi);
  let notifyOldCacheOpen;
  const oldCacheOpen = new Promise((resolve) => { notifyOldCacheOpen = resolve; });
  let releaseOldCacheOpen;
  const oldCacheGate = new Promise((resolve) => { releaseOldCacheOpen = resolve; });
  let oldCacheOpenWasGated = false;
  cachesApi.open = async (name) => {
    if (name === v1.cacheName && !oldCacheOpenWasGated) {
      oldCacheOpenWasGated = true;
      notifyOldCacheOpen();
      await oldCacheGate;
    }
    return originalOpen(name);
  };

  const pendingResponse = worker.get('/fixtures/text.json');
  await oldCacheOpen;
  await replaceThroughWorker({ worker, fixtureStore, cachesApi, version: 'v2' });
  assert.deepEqual(cachesApi.deleteAttempts, [v1.cacheName]);

  releaseOldCacheOpen();
  const response = await pendingResponse;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Fixture-Version'), 'v2');
  assert.equal(await response.text(), bodyText(v2.bodies.get('/fixtures/text.json')));
});
