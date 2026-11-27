import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  DOWNLOAD_HEADER,
  DOWNLOAD_INDEX_CACHE,
  DOWNLOAD_INDEX_RESOURCE,
  ITEM_CACHE_PREFIX,
  DownloadManager,
} from '../public/modules/downloads.js';
import { VesnaApi } from '../public/modules/api.js';

const ORIGIN = 'https://downloads.test';
const encoder = new TextEncoder();

function urlOf(input) {
  return new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
}

class MemoryCache {
  values = new Map();
  async put(input, response) { this.values.set(urlOf(input), response.clone()); }
  async match(input) { return this.values.get(urlOf(input))?.clone(); }
}

class MemoryCaches {
  values = new Map();
  failIndexPut = false;
  failItemPut = false;
  corruptNextAudioPut = false;
  unreadableNextAudioMatch = false;
  failedDeletes = new Set();
  async open(name) {
    if (!this.values.has(name)) {
      const cache = new MemoryCache();
      cache.put = async (input, response) => {
        if (
          name === DOWNLOAD_INDEX_CACHE && this.failIndexPut &&
          urlOf(input).endsWith(DOWNLOAD_INDEX_RESOURCE)
        ) throw new Error('index full');
        if (name.startsWith(ITEM_CACHE_PREFIX) && this.failItemPut) throw new Error('item cache full');
        const key = urlOf(input);
        cache.values.set(key, response.clone());
        if (name.startsWith(ITEM_CACHE_PREFIX) && key.endsWith('/audio') && this.corruptNextAudioPut) {
          this.corruptNextAudioPut = false;
          cache.values.set(key, new Response(null, { status: 200 }));
        }
      };
      cache.match = async (input) => {
        const key = urlOf(input);
        if (name.startsWith(ITEM_CACHE_PREFIX) && key.endsWith('/audio') && this.unreadableNextAudioMatch) {
          this.unreadableNextAudioMatch = false;
          return { status: 200, arrayBuffer: async () => { throw new Error('unreadable body'); } };
        }
        return cache.values.get(key)?.clone();
      };
      this.values.set(name, cache);
    }
    return this.values.get(name);
  }
  async delete(name) {
    if (this.failedDeletes.has(name)) throw new Error('delete failed');
    return this.values.delete(name);
  }
  async keys() { return [...this.values.keys()]; }
}

function item(version = 'version-1', overrides = {}) {
  return {
    id: 'item-1', kind: 'markdown', title: 'Offline story', source_url: null,
    filename: 'story.md', state: 'ready', error: null, version, paragraph_count: 1,
    ...overrides,
  };
}

function fixture(version = 'version-1', overrides = {}) {
  const id = overrides.id ?? 'item-1';
  const text = overrides.text ?? JSON.stringify({ version, paragraphs: [{ id: 'p0', text: `Text for ${version}` }] });
  const timings = overrides.timings ?? JSON.stringify({ version, timings: [{ id: 'p0', start: 0, end: 1 }] });
  const audio = overrides.expectedAudio ?? encoder.encode(`complete audio ${version}`);
  const servedAudio = overrides.servedAudio ?? audio;
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const manifest = JSON.stringify({
    format: 1, item_id: overrides.manifestItemId ?? id, version, voice_id: 'fixture', paragraph_count: 1, duration: 1,
    text_sha256: hash(text), audio_sha256: hash(audio), timings_sha256: hash(timings),
    paragraphs: [{ id: 'p0', text_sha256: hash(`Text for ${version}`) }],
  });
  return { text, timings, audio: servedAudio, manifest };
}

function world({ persistent = true, quota = 1_000_000 } = {}) {
  const api = new VesnaApi({ fetchImpl: async () => { throw new Error('unused'); } });
  const caches = new MemoryCaches();
  const fixtures = new Map();
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(urlOf(input));
    calls.push({ path: url.pathname, method: options.method ?? 'GET', headers: options.headers });
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers[DOWNLOAD_HEADER], '1');
    const match = /^\/api\/items\/([^/]+)\/versions\/([^/]+)\/(manifest|text|timings|audio)$/.exec(url.pathname);
    if (!match) return new Response(null, { status: 404 });
    const [, id, version, kind] = match;
    const current = fixtures.get(`${id}:${version}`);
    if (!current) return new Response(null, { status: 404 });
    if (options.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'Content-Length': String(current.audio.byteLength) } });
    }
    const body = current[kind];
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': kind === 'audio' ? 'audio/mpeg' : 'application/json' },
    });
  };
  const storage = {
    persisted: async () => false,
    persist: async () => persistent,
    estimate: async () => ({ usage: 100, quota }),
  };
  const manager = new DownloadManager({
    api, cachesApi: caches, fetchImpl, cryptoImpl: webcrypto, storageManager: storage, origin: ORIGIN,
  });
  return {
    api, caches, manager, calls, fixtures,
    add(value = item(), fixtureOverrides = {}) {
      const data = fixture(value.version, { id: value.id, ...fixtureOverrides });
      fixtures.set(`${value.id}:${value.version}`, data);
      return data;
    },
  };
}

test('a complete explicit download publishes only verified resources and playback metadata', async () => {
  const w = world();
  const current = item();
  w.add(current);
  const result = await w.manager.download(current);
  assert.equal(result.download.status, 'ready');
  assert.equal(result.download.persistent, true);
  assert.equal(result.warning, null);
  const listed = await w.manager.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, 'Offline story');
  assert.equal(listed[0].download.status, 'ready');
  const detail = await w.manager.get(current.id);
  assert.equal(detail.source_available, false);
  assert.equal(detail.item.version, current.version);
  const indexCache = await w.caches.open(DOWNLOAD_INDEX_CACHE);
  const index = await (await indexCache.match(`${ORIGIN}${DOWNLOAD_INDEX_RESOURCE}`)).json();
  assert.equal(index.items[0].resources.length, 4);
  assert.equal(JSON.stringify(index).includes('password'), false);
  assert.equal(w.calls.some((call) => call.path.includes('/auth/')), false);
});

test('persistent-storage denial leaves an honest ready state with a retention warning', async () => {
  const w = world({ persistent: false });
  const current = item();
  w.add(current);
  const result = await w.manager.download(current);
  assert.equal(result.download.status, 'ready');
  assert.equal(result.download.persistent, false);
  assert.match(result.warning, /may remove/);
});

test('an interrupted first download publishes nothing', async () => {
  const w = world();
  const current = item();
  const data = w.add(current);
  // Replace only the network function while retaining the manager contract.
  w.manager.fetch = async (input, options = {}) => {
    if (urlOf(input).endsWith('/timings')) throw new TypeError('offline');
    const url = new URL(urlOf(input));
    const kind = url.pathname.split('/').pop();
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': String(data.audio.byteLength) } });
    return new Response(data[kind], { status: 200 });
  };
  await assert.rejects(w.manager.download(current), /offline/);
  assert.deepEqual(await w.manager.list(), []);
});

test('an invalid replacement preserves the previous complete version', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const second = item('version-2');
  w.add(second, { servedAudio: encoder.encode('changed after hashing') });
  await assert.rejects(w.manager.download(second), /integrity/);
  const listed = await w.manager.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].version, 'version-1');
  assert.equal(listed[0].download.status, 'ready');
});

test('an index-write failure preserves the previous publication', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const second = item('version-2');
  w.add(second);
  w.caches.failIndexPut = true;
  await assert.rejects(w.manager.download(second), /index full/);
  w.caches.failIndexPut = false;
  assert.equal((await w.manager.list())[0].version, 'version-1');
});

test('missing published data is reported as lost, never offline-ready', async () => {
  const w = world();
  const current = item();
  w.add(current);
  await w.manager.download(current);
  const index = await w.manager.readIndex();
  await w.caches.delete(index.items[0].cacheName);
  const listed = await w.manager.list();
  assert.equal(listed[0].download.status, 'lost');
  const detail = await w.manager.get(current.id);
  assert.equal(detail.item.download.status, 'lost');
  assert.deepEqual(detail.paragraphs, []);
});

test('malformed and mismatched manifest metadata never publish', async (t) => {
  for (const kind of ['malformed', 'wrong-item']) {
    await t.test(kind, async () => {
      const w = world();
      const current = item();
      const data = w.add(current, kind === 'wrong-item' ? { manifestItemId: 'another-item' } : {});
      if (kind === 'malformed') data.manifest = '{not json';
      await assert.rejects(w.manager.download(current));
      assert.deepEqual(await w.manager.list(), []);
    });
  }
});

test('non-200 resources and inconsistent prepared data never publish', async (t) => {
  await t.test('non-200', async () => {
    const w = world();
    const current = item();
    w.add(current);
    const original = w.manager.fetch;
    w.manager.fetch = async (input, options = {}) => (
      urlOf(input).endsWith('/timings') ? new Response(null, { status: 503 }) : original(input, options)
    );
    await assert.rejects(w.manager.download(current), /could not be downloaded/);
    assert.deepEqual(await w.manager.list(), []);
  });
  await t.test('text and timings mismatch', async () => {
    const w = world();
    const current = item();
    w.add(current, {
      timings: JSON.stringify({ version: current.version, timings: [{ id: 'other', start: 0, end: 1 }] }),
    });
    await assert.rejects(w.manager.download(current), /inconsistent/);
    assert.deepEqual(await w.manager.list(), []);
  });
});

test('staged empty or unreadable cached bodies fail before publication', async (t) => {
  for (const kind of ['corruptNextAudioPut', 'unreadableNextAudioMatch']) {
    await t.test(kind, async () => {
      const w = world();
      const current = item();
      w.add(current);
      w.caches[kind] = true;
      await assert.rejects(w.manager.download(current), /staged download/);
      assert.deepEqual(await w.manager.list(), []);
    });
  }
});

test('corrupted, truncated, empty, and unreadable published bodies become lost', async (t) => {
  for (const kind of ['corrupted-text', 'truncated-audio', 'empty-audio', 'unreadable-audio']) {
    await t.test(kind, async () => {
      const w = world();
      const current = item();
      const data = w.add(current);
      await w.manager.download(current);
      const record = (await w.manager.readIndex()).items[0];
      const cache = await w.caches.open(record.cacheName);
      if (kind === 'corrupted-text') {
        await cache.put(`${ORIGIN}${w.api.textUrl(current.id, current.version)}`, new Response('{}', { status: 200 }));
      } else if (kind === 'truncated-audio') {
        await cache.put(`${ORIGIN}${w.api.audioUrl(current.id, current.version)}`, new Response(data.audio.slice(1), { status: 200 }));
      } else if (kind === 'empty-audio') {
        await cache.put(`${ORIGIN}${w.api.audioUrl(current.id, current.version)}`, new Response(null, { status: 200 }));
      } else {
        w.caches.unreadableNextAudioMatch = true;
      }
      assert.equal((await w.manager.list())[0].download.status, 'lost');
    });
  }
});

test('insufficient estimated space stops before the audio download', async () => {
  const w = world({ quota: 105 });
  const current = item();
  w.add(current);
  await assert.rejects(w.manager.download(current), /not enough free device storage/);
  assert.equal(w.calls.some((call) => call.path.endsWith('/audio') && call.method === 'GET'), false);
  assert.deepEqual(await w.manager.list(), []);
});

test('removal and server reconciliation affect only their target items', async () => {
  const w = world();
  const first = item();
  const second = item('version-1', { id: 'item-2', title: 'Second' });
  w.add(first);
  w.add(second);
  await w.manager.download(first);
  await w.manager.download(second);
  assert.equal(await w.manager.remove(first.id), true);
  assert.deepEqual((await w.manager.list()).map((entry) => entry.id), [second.id]);

  const onlineSecond = { ...second, version: 'version-2' };
  w.add(onlineSecond);
  const reconciled = await w.manager.reconcile([onlineSecond]);
  assert.equal(reconciled[0].download.status, 'update-available');
  assert.equal(reconciled[0].download.version, 'version-1');
  assert.equal((await w.manager.get(second.id)).item.version, 'version-1');
  await w.manager.reconcile([]);
  assert.deepEqual(await w.manager.list(), []);
});

test('an item-cache write failure preserves the previous publication', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const second = item('version-2');
  w.add(second);
  w.caches.failItemPut = true;
  await assert.rejects(w.manager.download(second), /item cache full/);
  w.caches.failItemPut = false;
  assert.equal((await w.manager.list())[0].version, 'version-1');
});

test('concurrent replacements are serialized and a later failure cannot roll back success', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const second = item('version-2');
  const third = item('version-3');
  w.add(second);
  w.add(third, { servedAudio: encoder.encode('invalid third audio') });
  const successful = w.manager.download(second);
  const failed = w.manager.download(third);
  await successful;
  await assert.rejects(failed, /integrity/);
  assert.equal((await w.manager.get(first.id)).item.version, 'version-2');
});

test('a throwing completion observer cannot delete a committed replacement', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const second = item('version-2');
  w.add(second);
  const result = await w.manager.download(second, {
    onProgress: ({ stage }) => {
      if (stage === 'complete') throw new Error('observer failed');
    },
  });
  assert.equal(result.download.version, 'version-2');
  assert.equal((await w.manager.get(first.id)).item.version, 'version-2');
  assert.equal((await w.manager.list())[0].download.status, 'ready');
});

test('old-cache cleanup failure cannot restore or damage a publication', async () => {
  const w = world();
  const first = item();
  w.add(first);
  await w.manager.download(first);
  const previousName = (await w.manager.readIndex()).items[0].cacheName;
  w.caches.failedDeletes.add(previousName);
  const second = item('version-2');
  w.add(second);
  await w.manager.download(second);
  assert.equal((await w.manager.get(first.id)).item.version, 'version-2');
  assert.equal(w.caches.values.has(previousName), true, 'orphan remains but is not published');
  assert.equal((await w.manager.readIndex()).items[0].cacheName === previousName, false);
});
