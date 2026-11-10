import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.example.test';

function request(path, { method = 'GET', mode = 'same-origin', url = `${ORIGIN}${path}` } = {}) {
  return { method, mode, url, headers: new Headers() };
}

function createWorker({ cacheNames = [], shellResponse = new Response('shell') } = {}) {
  const listeners = new Map();
  const opened = [];
  const added = [];
  const deleted = [];
  let skipWaiting = false;
  let claimed = false;
  const cache = {
    async addAll(resources) { added.push(...resources); },
    async match(input) {
      const url = typeof input === 'string' ? input : input.url;
      return url.includes('/index.html') || url.endsWith('/app.js') ? shellResponse : undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: async () => { skipWaiting = true; },
    addEventListener(name, listener) { listeners.set(name, listener); },
  };
  const caches = {
    async open(name) { opened.push(name); return cache; },
    async keys() { return cacheNames; },
    async delete(name) { deleted.push(name); return true; },
  };
  const context = vm.createContext({ self, caches, fetch: async () => new Response('network'), URL, Response, Headers });
  new vm.Script(source, { filename: 'public/sw.js' }).runInContext(context);

  return {
    listeners,
    opened,
    added,
    deleted,
    get skipWaiting() { return skipWaiting; },
    get claimed() { return claimed; },
    async install() {
      let pending;
      listeners.get('install')({ waitUntil(value) { pending = Promise.resolve(value); } });
      await pending;
    },
    async activate() {
      let pending;
      listeners.get('activate')({ waitUntil(value) { pending = Promise.resolve(value); } });
      await pending;
    },
    async fetch(req) {
      let pending;
      listeners.get('fetch')({ request: req, respondWith(value) { pending = Promise.resolve(value); } });
      return pending ? { handled: true, response: await pending } : { handled: false };
    },
  };
}

test('installation caches only the declared public application shell', async () => {
  const worker = createWorker();
  await worker.install();
  assert.equal(worker.skipWaiting, true);
  assert.deepEqual(worker.opened, ['vesna-app-shell-v1']);
  assert.ok(worker.added.includes('/index.html'));
  assert.ok(worker.added.includes('/app.js'));
  assert.equal(worker.added.some((resource) => resource.startsWith('/api/')), false);
  assert.equal(worker.added.some((resource) => resource.includes('auth')), false);
  assert.equal(worker.added.some((resource) => resource.includes('fixture')), false);
  assert.equal(worker.added.some((resource) => resource.includes('/source')), false);
  assert.equal(worker.added.some((resource) => resource.includes('/audio')), false);
});

test('every API route bypasses the service worker even for GET audio and source requests', async () => {
  const worker = createWorker();
  for (const path of [
    '/api/auth/session',
    '/api/items',
    '/api/items/item-1/source',
    '/api/items/item-1/versions/version-1/text',
    '/api/items/item-1/versions/version-1/timings',
    '/api/items/item-1/versions/version-1/audio',
  ]) {
    assert.deepEqual(await worker.fetch(request(path)), { handled: false }, path);
  }
  assert.deepEqual(await worker.fetch(request('/api/items/item-1/retry', { method: 'POST' })), { handled: false });
  assert.deepEqual(worker.opened, [], 'private requests never open a cache');
});

test('cross-origin and mutating requests bypass the worker', async () => {
  const worker = createWorker();
  assert.equal((await worker.fetch(request('', { url: 'https://other.example.test/app.js' }))).handled, false);
  assert.equal((await worker.fetch(request('/app.js', { method: 'POST' }))).handled, false);
  assert.deepEqual(worker.opened, []);
});

test('known public shell resources use the shell cache', async () => {
  const cached = new Response('cached public module');
  const worker = createWorker({ shellResponse: cached });
  const result = await worker.fetch(request('/app.js'));
  assert.equal(result.handled, true);
  assert.equal(result.response, cached);
  assert.equal(await result.response.text(), 'cached public module');
});

test('non-API navigation can use the public index fallback', async () => {
  const cached = new Response('public index');
  const worker = createWorker({ shellResponse: cached });
  const result = await worker.fetch(request('/library', { mode: 'navigate' }));
  assert.equal(result.handled, true);
  assert.equal(result.response, cached);
});

test('activation removes only old application shell caches and claims clients', async () => {
  const worker = createWorker({
    cacheNames: [
      'vesna-app-shell-v0',
      'vesna-app-shell-v1',
      'vesna-probe-shell-v12',
      'vesna-probe-fixture-v1',
      'unrelated-private-cache',
    ],
  });
  await worker.activate();
  assert.equal(worker.claimed, true);
  assert.deepEqual(worker.deleted, ['vesna-app-shell-v0']);
});
