import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replaceOfflineFixture,
  waitForOfflineReadiness,
} from '../src/offline.js';
import { OfflineFixtureStore } from '../src/storage.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

class FakeWorker {
  constructor() {
    this.state = 'installing';
    this.listeners = new Map();
  }
  addEventListener(name, handler) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(handler);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== handler));
  }
  listenerCount(name) { return (this.listeners.get(name) ?? []).length; }
  activate() {
    this.state = 'activated';
    for (const handler of this.listeners.get('statechange') ?? []) handler();
  }
}

class FakeResponse {
  constructor(ok = true) { this.ok = ok; }
  clone() { return new FakeResponse(this.ok); }
}

class FakeCache {
  constructor() { this.values = new Map(); }
  async put(url, response) { this.values.set(url, response); }
  async match(url) { return this.values.get(url); }
}

class FakeCaches {
  constructor() { this.values = new Map(); this.deleted = []; }
  async open(name) {
    if (!this.values.has(name)) this.values.set(name, new FakeCache());
    return this.values.get(name);
  }
  async delete(name) {
    this.deleted.push(name);
    return this.values.delete(name);
  }
}

function fixtureStore() {
  return new OfflineFixtureStore(new MemoryStorage());
}

test('offline readiness matches absolute cache keys for same-origin paths', async () => {
  const cachesApi = new FakeCaches();
  const shell = await cachesApi.open('shell-cache');
  await shell.put('https://vesna.test/', new FakeResponse());
  const result = await waitForOfflineReadiness({
    serviceWorker: {
      register: async () => ({ ready: Promise.resolve({ active: {} }) }),
    },
    cachesApi,
    requiredResources: ['/'],
    cacheNames: ['shell-cache'],
    origin: 'https://vesna.test',
  });
  assert.ok(result.active);
});

test('offline readiness waits for the installing worker before checking its shell cache', async () => {
  const cachesApi = new FakeCaches();
  const shell = await cachesApi.open('new-shell');
  await shell.put('https://vesna.test/index.html', new FakeResponse());
  const oldActive = { scriptURL: 'old.js' };
  const newWorker = new FakeWorker();
  const registration = { active: oldActive, installing: newWorker };
  const serviceWorker = {
    register: async () => registration,
    ready: Promise.resolve(registration),
  };

  const resultPromise = waitForOfflineReadiness({
    serviceWorker,
    registration: Promise.resolve(registration),
    cachesApi,
    requiredResources: ['/index.html'],
    cacheNames: ['new-shell'],
    origin: 'https://vesna.test',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(newWorker.listenerCount('statechange'), 1);
  newWorker.activate();
  const result = await resultPromise;
  assert.equal(result.active, newWorker);
});

test('offline readiness waits for an active registration and verifies every required cache resource', async () => {
  const cachesApi = new FakeCaches();
  const shell = await cachesApi.open('shell-cache');
  await shell.put('/index.html', new FakeResponse());
  await shell.put('/app.js', new FakeResponse());
  const serviceWorker = {
    controller: null,
    register: async () => ({ ready: Promise.resolve({ active: {} }) }),
  };

  const result = await waitForOfflineReadiness({
    serviceWorker,
    cachesApi,
    requiredResources: ['/index.html', '/app.js'],
    cacheNames: ['shell-cache'],
  });

  assert.ok(result.active);
});

test('offline readiness rejects when the shell is incomplete', async () => {
  const cachesApi = new FakeCaches();
  const shell = await cachesApi.open('shell-cache');
  await shell.put('/index.html', new FakeResponse());

  await assert.rejects(
    waitForOfflineReadiness({
      serviceWorker: {
        register: async () => ({ ready: Promise.resolve({ active: {} }) }),
      },
      cachesApi,
      requiredResources: ['/index.html', '/app.js'],
      cacheNames: ['shell-cache'],
    }),
    /offline resource is not cached.*app\.js/,
  );
});

test('fixture replacement verifies the new cache before publishing and removes the old cache afterward', async () => {
  const cachesApi = new FakeCaches();
  const oldCache = await cachesApi.open('fixture-old');
  await oldCache.put('/fixtures/manifest.json', new FakeResponse());
  await oldCache.put('/fixtures/text.json', new FakeResponse());
  await oldCache.put('/fixtures/timings.json', new FakeResponse());
  const store = fixtureStore();
  store.publish({
    version: 'fixture-v1',
    resources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
    cacheName: 'fixture-old',
  });

  const published = await replaceOfflineFixture({
    version: 'fixture-v2',
    resources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
    cacheName: 'fixture-new',
    fetchImpl: async () => new FakeResponse(),
    cachesApi,
    fixtureStore: store,
    requiredResources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
    cacheNames: ['fixture-new'],
  });

  assert.deepEqual(published, {
    version: 'fixture-v2',
    resources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
    cacheName: 'fixture-new',
    ready: true,
  });
  assert.deepEqual(store.read(), published);
  assert.deepEqual(cachesApi.deleted, ['fixture-old']);
  assert.ok(await (await cachesApi.open('fixture-new')).match('/fixtures/timings.json'));
});

test('failed fixture replacement preserves the ready fixture and metadata', async () => {
  const cachesApi = new FakeCaches();
  const oldCache = await cachesApi.open('fixture-old');
  await oldCache.put('/fixtures/manifest.json', new FakeResponse());
  await oldCache.put('/fixtures/text.json', new FakeResponse());
  await oldCache.put('/fixtures/timings.json', new FakeResponse());
  const store = fixtureStore();
  const previous = {
    version: 'fixture-v1',
    resources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
    cacheName: 'fixture-old',
  };
  store.publish(previous);

  await assert.rejects(
    replaceOfflineFixture({
      version: 'fixture-v2',
      resources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
      cacheName: 'fixture-new',
      fetchImpl: async (url) => new FakeResponse(url.endsWith('timings.json') ? false : true),
      cachesApi,
      fixtureStore: store,
      requiredResources: ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json'],
      cacheNames: ['fixture-new'],
    }),
    /resource download failed/,
  );

  assert.deepEqual(store.read(), { ...previous, ready: true });
  assert.ok(await oldCache.match('/fixtures/text.json'));
  assert.deepEqual(cachesApi.deleted, ['fixture-new']);
});
