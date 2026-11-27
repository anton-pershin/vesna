import { validatePreparedVersion } from './prepared.js';

export const DOWNLOAD_INDEX_CACHE = 'vesna-offline-index-v1';
export const DOWNLOAD_INDEX_RESOURCE = '/__vesna_offline_library_index__';
export const DOWNLOAD_HEADER = 'X-Vesna-Download';
export const DOWNLOAD_LOCK = 'vesna-offline-library';
export const ITEM_CACHE_PREFIX = 'vesna-item-';

const decoder = new TextDecoder();
let fallbackQueue = Promise.resolve();

export class DownloadError extends Error {
  constructor(message, code = 'DOWNLOAD_FAILED', status) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.status = status;
  }
}

function absolute(url, origin) {
  return new URL(url, origin ?? globalThis.location?.origin).href;
}

function cloneDownload(download) {
  return download ? { ...download } : undefined;
}

function publicItem(item, download) {
  return { ...item, download: cloneDownload(download) };
}

function validateItem(item) {
  if (
    !item || typeof item.id !== 'string' || !item.id ||
    typeof item.version !== 'string' || !item.version || item.state !== 'ready'
  ) {
    throw new DownloadError('Only a ready prepared item can be downloaded.', 'ITEM_NOT_READY');
  }
}

function validateManifest(value, item) {
  if (
    !value || value.format !== 1 || value.item_id !== item.id || value.version !== item.version ||
    !Number.isSafeInteger(value.paragraph_count) || value.paragraph_count < 1 ||
    !Number.isFinite(value.duration) || value.duration <= 0
  ) {
    throw new DownloadError('The prepared manifest does not match this item.', 'INVALID_MANIFEST');
  }
  for (const key of ['text_sha256', 'audio_sha256', 'timings_sha256']) {
    if (typeof value[key] !== 'string' || !/^[0-9a-f]{64}$/.test(value[key])) {
      throw new DownloadError('The prepared manifest has no valid integrity hashes.', 'INVALID_MANIFEST');
    }
  }
  return value;
}

function validateIndex(value) {
  if (!value || value.format !== 1 || !Array.isArray(value.items)) {
    throw new DownloadError('The offline library index is invalid.', 'INVALID_INDEX');
  }
  const ids = new Set();
  for (const record of value.items) {
    if (
      !record || record.format !== 1 || !record.item ||
      typeof record.item.id !== 'string' || !record.item.id || ids.has(record.item.id) ||
      typeof record.version !== 'string' || !record.version ||
      typeof record.cacheName !== 'string' || !record.cacheName.startsWith(ITEM_CACHE_PREFIX) ||
      !Array.isArray(record.resources) || record.resources.length !== 4 ||
      record.resources.some((resource) => typeof resource !== 'string' || !resource)
    ) {
      throw new DownloadError('The offline library index is invalid.', 'INVALID_INDEX');
    }
    ids.add(record.item.id);
  }
  return value;
}

function recordFor(item, manifest, cacheName, resources, persistence) {
  return {
    format: 1,
    item: { ...item, download: undefined },
    version: item.version,
    cacheName,
    resources: [...resources],
    downloadedAt: new Date().toISOString(),
    persistent: persistence.persistent,
    manifest,
  };
}

function downloadState(record, status = 'ready') {
  return {
    status,
    version: record.version,
    downloadedAt: record.downloadedAt,
    persistent: record.persistent === true,
  };
}

export class DownloadManager {
  constructor({
    api,
    cachesApi = globalThis.caches,
    fetchImpl = globalThis.fetch,
    cryptoImpl = globalThis.crypto,
    storageManager = globalThis.navigator?.storage,
    locks = globalThis.navigator?.locks,
    origin = globalThis.location?.origin,
  } = {}) {
    if (!api || !cachesApi || typeof fetchImpl !== 'function' || !cryptoImpl?.subtle || !origin) {
      throw new TypeError('Download API, Cache Storage, fetch, SHA-256, and origin are required');
    }
    this.api = api;
    this.caches = cachesApi;
    this.fetch = fetchImpl;
    this.crypto = cryptoImpl;
    this.storage = storageManager;
    this.locks = locks;
    this.origin = origin;
  }

  withLock(operation) {
    if (typeof this.locks?.request === 'function') {
      return this.locks.request(DOWNLOAD_LOCK, { mode: 'exclusive' }, operation);
    }
    const run = fallbackQueue.catch(() => {}).then(operation);
    fallbackQueue = run.catch(() => {});
    return run;
  }

  indexUrl() {
    return absolute(DOWNLOAD_INDEX_RESOURCE, this.origin);
  }

  async readIndex() {
    const cache = await this.caches.open(DOWNLOAD_INDEX_CACHE);
    const response = await cache.match(this.indexUrl());
    if (!response) return { format: 1, items: [] };
    let value;
    try {
      value = await response.json();
    } catch {
      throw new DownloadError('The offline library index cannot be read.', 'INVALID_INDEX');
    }
    return validateIndex(value);
  }

  async writeIndex(items) {
    const cache = await this.caches.open(DOWNLOAD_INDEX_CACHE);
    const response = new Response(JSON.stringify({ format: 1, items }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    await cache.put(this.indexUrl(), response);
  }

  async request(url, { method = 'GET', accept = 'application/json' } = {}) {
    let response;
    try {
      response = await this.fetch.call(globalThis, absolute(url, this.origin), {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: accept, [DOWNLOAD_HEADER]: '1' },
      });
    } catch (error) {
      throw error;
    }
    if (method === 'HEAD') {
      if (!response.ok) {
        throw new DownloadError('The prepared audio size is unavailable.', 'DOWNLOAD_HTTP', response.status);
      }
      return response;
    }
    if (!response.ok || response.status !== 200) {
      throw new DownloadError(
        response.status === 401 ? 'Your session has expired. Sign in again.' : 'A prepared resource could not be downloaded.',
        response.status === 401 ? 'AUTH_REQUIRED' : 'DOWNLOAD_HTTP',
        response.status,
      );
    }
    return response;
  }

  async digest(bytes) {
    const value = await this.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, '0')).join('');
  }

  async fetchBytes(url, accept) {
    const response = await this.request(url, { accept });
    const bytes = await response.arrayBuffer();
    return { bytes, response };
  }

  async persistence() {
    if (!this.storage) return { persistent: false, warning: 'Persistent storage is unavailable in this browser.' };
    try {
      const alreadyPersistent = typeof this.storage.persisted === 'function'
        ? await this.storage.persisted()
        : false;
      const persistent = alreadyPersistent || (
        typeof this.storage.persist === 'function' ? await this.storage.persist() : false
      );
      return {
        persistent: persistent === true,
        warning: persistent === true
          ? null
          : 'The browser did not grant persistent storage. It may remove this download when space is needed.',
      };
    } catch {
      return {
        persistent: false,
        warning: 'Persistent storage could not be checked. The browser may remove this download when space is needed.',
      };
    }
  }

  async checkSpace(audioUrl) {
    const response = await this.request(audioUrl, { method: 'HEAD', accept: 'audio/mpeg' });
    const length = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(length) || length < 1) {
      throw new DownloadError('The prepared audio is empty or has no valid size.', 'INVALID_AUDIO');
    }
    if (typeof this.storage?.estimate !== 'function') return length;
    try {
      const estimate = await this.storage.estimate();
      if (
        Number.isFinite(estimate?.usage) && Number.isFinite(estimate?.quota) &&
        length > estimate.quota - estimate.usage
      ) {
        throw new DownloadError('There is not enough free device storage for this audio.', 'INSUFFICIENT_SPACE');
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      // A later cache-write failure remains an explicit download failure.
    }
    return length;
  }

  async stageResource(cache, { url, accept, expectedHash, kind }) {
    const { bytes, response } = await this.fetchBytes(url, accept);
    if (kind === 'audio' && bytes.byteLength === 0) {
      throw new DownloadError('The prepared audio is empty.', 'INVALID_AUDIO');
    }
    if (expectedHash && await this.digest(bytes) !== expectedHash) {
      throw new DownloadError(`The downloaded ${kind} failed its integrity check.`, 'INTEGRITY_MISMATCH');
    }
    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || (kind === 'audio' ? 'audio/mpeg' : 'application/json'));
    headers.set('Content-Length', String(bytes.byteLength));
    headers.set('Cache-Control', 'no-store');
    if (kind === 'audio') headers.set('Accept-Ranges', 'bytes');
    await cache.put(absolute(url, this.origin), new Response(bytes, { status: 200, headers }));
    return bytes;
  }

  async verifyRecord(record) {
    try {
      validateIndex({ format: 1, items: [record] });
      const cache = await this.caches.open(record.cacheName);
      const bodies = new Map();
      for (const url of record.resources) {
        const response = await cache.match(absolute(url, this.origin));
        if (!response || response.status !== 200) throw new Error('missing resource');
        // Verify the stored body, not only the network bytes or response metadata.
        bodies.set(url, await response.arrayBuffer());
      }
      const manifestUrl = this.api.manifestUrl(record.item.id, record.version);
      const textUrl = this.api.textUrl(record.item.id, record.version);
      const timingsUrl = this.api.timingsUrl(record.item.id, record.version);
      const audioUrl = this.api.audioUrl(record.item.id, record.version);
      const manifest = validateManifest(
        JSON.parse(decoder.decode(bodies.get(manifestUrl))),
        { ...record.item, version: record.version, state: 'ready' },
      );
      for (const [url, key] of [
        [textUrl, 'text_sha256'],
        [timingsUrl, 'timings_sha256'],
        [audioUrl, 'audio_sha256'],
      ]) {
        if (await this.digest(bodies.get(url)) !== manifest[key]) throw new Error('cached hash mismatch');
      }
      const audio = bodies.get(audioUrl);
      if (!audio || audio.byteLength === 0) throw new Error('empty cached audio');
      const text = JSON.parse(decoder.decode(bodies.get(textUrl)));
      const timings = JSON.parse(decoder.decode(bodies.get(timingsUrl)));
      const prepared = validatePreparedVersion(text, timings, record.version);
      if (
        manifest.paragraph_count !== prepared.paragraphs.length ||
        Math.abs(manifest.duration - prepared.duration) > 0.1
      ) {
        throw new Error('manifest and prepared data differ');
      }
      return { lost: false };
    } catch {
      return { lost: true };
    }
  }

  async entries() {
    const index = await this.readIndex();
    const entries = [];
    for (const record of index.items) {
      const verification = await this.verifyRecord(record);
      entries.push({ record, ...verification });
    }
    return entries;
  }

  async list() {
    const entries = await this.entries();
    return entries.map(({ record, lost }) => publicItem(
      { ...record.item, state: 'ready', version: record.version },
      downloadState(record, lost ? 'lost' : 'ready'),
    ));
  }

  async get(itemId) {
    const entries = await this.entries();
    const entry = entries.find(({ record }) => record.item.id === itemId);
    if (!entry) throw new DownloadError('This item is not downloaded on this device.', 'NOT_DOWNLOADED');
    return {
      item: publicItem(
        { ...entry.record.item, state: 'ready', version: entry.record.version },
        downloadState(entry.record, entry.lost ? 'lost' : 'ready'),
      ),
      paragraphs: [],
      source_available: false,
    };
  }

  async reconcile(serverItems) {
    return this.withLock(async () => {
      const index = await this.readIndex();
      const serverIds = new Set(serverItems.map((item) => item.id));
      const retained = index.items.filter((record) => serverIds.has(record.item.id));
      if (retained.length !== index.items.length) await this.writeIndex(retained);
      const removed = index.items.filter((record) => !serverIds.has(record.item.id));
      for (const record of removed) {
        try { await this.caches.delete(record.cacheName); } catch { /* An orphan is not published. */ }
      }

      const byId = new Map(retained.map((record) => [record.item.id, record]));
      const result = [];
      for (const item of serverItems) {
        const record = byId.get(item.id);
        if (!record) {
          result.push({ ...item });
          continue;
        }
        const { lost } = await this.verifyRecord(record);
        const status = lost
          ? 'lost'
          : (item.version && item.version !== record.version ? 'update-available' : 'ready');
        result.push(publicItem(item, downloadState(record, status)));
      }
      return result;
    });
  }

  async download(item, { onProgress = () => {} } = {}) {
    validateItem(item);
    return this.withLock(async () => {
      const index = await this.readIndex();
      const previous = index.items.find((record) => record.item.id === item.id) ?? null;
      const unique = this.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const cacheName = `${ITEM_CACHE_PREFIX}${encodeURIComponent(item.id)}-${encodeURIComponent(item.version)}-${unique}`;
      const resources = [
        this.api.manifestUrl(item.id, item.version),
        this.api.textUrl(item.id, item.version),
        this.api.timingsUrl(item.id, item.version),
        this.api.audioUrl(item.id, item.version),
      ];
      const staging = await this.caches.open(cacheName);
      let published = false;
      try {
        onProgress({ stage: 'manifest', completed: 0, total: 4 });
        const manifestBytes = await this.stageResource(staging, {
          url: resources[0], accept: 'application/json', kind: 'manifest',
        });
        let manifest;
        try {
          manifest = validateManifest(JSON.parse(decoder.decode(manifestBytes)), item);
        } catch (error) {
          if (error instanceof DownloadError) throw error;
          throw new DownloadError('The prepared manifest is not valid JSON.', 'INVALID_MANIFEST');
        }

        onProgress({ stage: 'storage', completed: 1, total: 4 });
        const persistence = await this.persistence();
        const audioLength = await this.checkSpace(resources[3]);
        onProgress({ stage: 'text', completed: 1, total: 4 });
        const textBytes = await this.stageResource(staging, {
          url: resources[1], accept: 'application/json', expectedHash: manifest.text_sha256, kind: 'text',
        });
        onProgress({ stage: 'timings', completed: 2, total: 4 });
        const timingsBytes = await this.stageResource(staging, {
          url: resources[2], accept: 'application/json', expectedHash: manifest.timings_sha256, kind: 'timings',
        });
        onProgress({ stage: 'audio', completed: 3, total: 4 });
        const audioBytes = await this.stageResource(staging, {
          url: resources[3], accept: 'audio/mpeg', expectedHash: manifest.audio_sha256, kind: 'audio',
        });
        if (audioBytes.byteLength !== audioLength) {
          throw new DownloadError('The audio size changed during download. Try again.', 'INTEGRITY_MISMATCH');
        }

        let prepared;
        try {
          prepared = validatePreparedVersion(
            JSON.parse(decoder.decode(textBytes)),
            JSON.parse(decoder.decode(timingsBytes)),
            item.version,
          );
        } catch {
          throw new DownloadError('The prepared text and timings are inconsistent.', 'INVALID_PREPARED');
        }
        if (
          manifest.paragraph_count !== prepared.paragraphs.length ||
          Math.abs(manifest.duration - prepared.duration) > 0.1
        ) {
          throw new DownloadError('The prepared manifest and listening data differ.', 'INVALID_PREPARED');
        }

        const record = recordFor(item, manifest, cacheName, resources, persistence);
        const verification = await this.verifyRecord(record);
        if (verification.lost) throw new DownloadError('The staged download could not be verified.', 'INVALID_STAGING');
        await this.writeIndex([...index.items.filter((record) => record.item.id !== item.id), record]);
        published = true;
        if (previous && previous.cacheName !== cacheName) {
          try { await this.caches.delete(previous.cacheName); } catch { /* The old cache is no longer published. */ }
        }
        try {
          onProgress({ stage: 'complete', completed: 4, total: 4 });
        } catch {
          // Observer failures cannot change or delete a committed publication.
        }
        return {
          item: publicItem(item, downloadState(record)),
          download: downloadState(record),
          warning: persistence.warning,
        };
      } catch (error) {
        if (!published) {
          try { await this.caches.delete(cacheName); } catch { /* An orphan staging cache is unreachable. */ }
        }
        throw error;
      }
    });
  }

  async remove(itemId) {
    return this.withLock(async () => {
      const index = await this.readIndex();
      const record = index.items.find((candidate) => candidate.item.id === itemId);
      if (!record) return false;
      await this.writeIndex(index.items.filter((candidate) => candidate.item.id !== itemId));
      try { await this.caches.delete(record.cacheName); } catch { /* The orphan remains unreachable. */ }
      return true;
    });
  }
}
