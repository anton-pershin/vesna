export const SHELL_CACHE = 'vesna-probe-shell-v12';
export const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/seekbar.js', '/modules/storage.js', '/modules/media-session.js', '/modules/offline.js', '/modules/fixture-download.js',
];
export const FIXTURE_RESOURCES = [
  '/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json', '/fixtures/audio/fixture.mp3',
];
export const REQUIRED_OFFLINE_RESOURCES = [...SHELL_RESOURCES, ...FIXTURE_RESOURCES];
export const FIXTURE_POINTER_CACHE = 'vesna-probe-fixture-pointer-v1';
export const FIXTURE_POINTER_RESOURCE = '/__vesna_offline_fixture_pointer__';
export const FIXTURE_DOWNLOAD_HEADER = 'X-Vesna-Fixture-Download';
export const FIXTURE_LOCK = 'vesna-offline-fixture';

const fixtureQueues = new WeakMap();

function resolveCacheRequest(url, origin) {
  const base = origin ?? globalThis.location?.origin;
  return base ? new URL(url, base).href : url;
}

function withFixtureLock(fixtureStore, operation) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === 'function') {
    return locks.request(FIXTURE_LOCK, { mode: 'exclusive' }, operation);
  }
  const previous = fixtureQueues.get(fixtureStore) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(operation);
  fixtureQueues.set(fixtureStore, run.catch(() => {}));
  return run;
}

async function cachedResponse(cache, url, origin) {
  const response = await cache.match(resolveCacheRequest(url, origin));
  if (!response || response.ok !== true) {
    throw new Error(`offline resource is not cached: ${url}`);
  }
  return response;
}

function fixtureRecord(record) {
  if (
    !record || typeof record.version !== 'string' || !record.version ||
    typeof record.cacheName !== 'string' || !record.cacheName ||
    !Array.isArray(record.resources) || record.resources.length === 0 ||
    record.resources.some((resource) => typeof resource !== 'string' || !resource)
  ) {
    throw new Error('invalid offline fixture pointer');
  }
  return { version: record.version, resources: [...record.resources], cacheName: record.cacheName };
}

function pointerRequest(origin) {
  return resolveCacheRequest(FIXTURE_POINTER_RESOURCE, origin);
}

export async function readOfflineFixturePointer(cachesApi, origin) {
  const cache = await cachesApi.open(FIXTURE_POINTER_CACHE);
  const response = await cache.match(pointerRequest(origin));
  if (!response) return null;
  return fixtureRecord(await response.json());
}

async function writeOfflineFixturePointer(cachesApi, record, origin) {
  const published = fixtureRecord(record);
  const cache = await cachesApi.open(FIXTURE_POINTER_CACHE);
  const response = new Response(JSON.stringify(published), {
    headers: { 'Content-Type': 'application/json' },
  });
  await cache.put(pointerRequest(origin), response);
  return published;
}

async function clearOfflineFixturePointer(cachesApi, origin) {
  const cache = await cachesApi.open(FIXTURE_POINTER_CACHE);
  await cache.delete(pointerRequest(origin));
}

async function readLegacyFixture(cachesApi, fixtureStore, origin) {
  const legacy = fixtureStore.read();
  if (!legacy?.cacheName) return null;
  const record = fixtureRecord(legacy);
  const cache = await cachesApi.open(record.cacheName);
  await verifyCachedResources(cache, record.resources, origin);
  return record;
}

async function restoreOfflineFixturePointerNow({ cachesApi, fixtureStore, origin }) {
  const existing = await readOfflineFixturePointer(cachesApi, origin);
  if (existing) return existing;
  const legacy = await readLegacyFixture(cachesApi, fixtureStore, origin);
  if (!legacy) return null;
  return writeOfflineFixturePointer(cachesApi, legacy, origin);
}

export function restoreOfflineFixturePointer(options) {
  return withFixtureLock(options.fixtureStore, () => restoreOfflineFixturePointerNow(options));
}

export async function verifyCachedResources(cache, resources, origin) {
  for (const url of resources) await cachedResponse(cache, url, origin);
  return true;
}

export async function verifyRequiredResources({ cachesApi, resources, cacheNames = [], origin }) {
  if (cacheNames.length > 0) {
    const cachesToCheck = await Promise.all(cacheNames.map((name) => cachesApi.open(name)));
    for (const url of resources) {
      let found = false;
      for (const cache of cachesToCheck) {
        const response = await cache.match(resolveCacheRequest(url, origin));
        if (response?.ok === true) {
          found = true;
          break;
        }
      }
      if (!found) throw new Error(`offline resource is not cached: ${url}`);
    }
    return true;
  }

  for (const url of resources) await cachedResponse(cachesApi, url, origin);
  return true;
}

export async function waitForRegistrationActivation(registration, serviceWorker) {
  const candidate = registration.installing ?? registration.waiting;
  if (candidate && candidate.state !== 'activated') {
    await new Promise((resolve, reject) => {
      const onStateChange = () => {
        if (candidate.state === 'activated') {
          candidate.removeEventListener('statechange', onStateChange);
          resolve();
        } else if (candidate.state === 'redundant') {
          candidate.removeEventListener('statechange', onStateChange);
          reject(new Error('service worker update did not activate'));
        }
      };
      candidate.addEventListener('statechange', onStateChange);
      onStateChange();
    });
    return candidate;
  }
  const ready = await (registration.ready ?? serviceWorker.ready ?? Promise.resolve(registration));
  return ready?.active ?? registration.active ?? serviceWorker.controller;
}

export async function waitForOfflineReadiness({
  serviceWorker,
  registration,
  cachesApi,
  requiredResources = REQUIRED_OFFLINE_RESOURCES,
  cacheNames = [],
  origin,
}) {
  if (!serviceWorker) throw new Error('service worker is unavailable');
  const registered = await (registration ?? serviceWorker.register('/sw.js'));
  const active = await waitForRegistrationActivation(registered, serviceWorker);
  if (!active) throw new Error('service worker is not active');
  await verifyRequiredResources({ cachesApi, resources: requiredResources, cacheNames, origin });
  return { registration: registered, active };
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function validateStagedFixture(staging, resources, version, origin) {
  const metadata = {};
  for (const url of ['/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json']) {
    let value;
    try {
      value = await (await cachedResponse(staging, url, origin)).json();
    } catch {
      throw new Error(`invalid fixture metadata: ${url}`);
    }
    if (value?.version !== version) throw new Error(`fixture version mismatch: ${url}`);
    metadata[url] = value;
  }

  const audioResources = resources.filter((url) => url.startsWith('/fixtures/audio/'));
  if (audioResources.length === 0) return;
  if (audioResources.length !== 1) throw new Error('fixture must contain one audio resource');
  const manifest = metadata['/fixtures/manifest.json'];
  if (`/fixtures/${manifest.audio}` !== audioResources[0]) {
    throw new Error('fixture audio path does not match the manifest');
  }
  if (!Number.isSafeInteger(manifest.audio_bytes) || manifest.audio_bytes < 1 ||
      typeof manifest.audio_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.audio_sha256)) {
    throw new Error('fixture audio integrity metadata is missing');
  }
  const bytes = await (await cachedResponse(staging, audioResources[0], origin)).arrayBuffer();
  if (bytes.byteLength !== manifest.audio_bytes) throw new Error('fixture audio length does not match');
  if (await sha256Hex(bytes) !== manifest.audio_sha256) throw new Error('fixture audio digest does not match');
}

async function replaceOfflineFixtureNow({
  version,
  resources,
  fetchImpl,
  cachesApi,
  fixtureStore,
  cacheName,
  requiredResources,
  cacheNames,
  origin,
}) {
  if (typeof version !== 'string' || !version || !Array.isArray(resources) || resources.length === 0) {
    throw new TypeError('invalid fixture download');
  }
  if (typeof fetchImpl !== 'function' || !cachesApi || !fixtureStore) {
    throw new TypeError('fixture download dependencies are required');
  }
  const stagingName = cacheName ?? `vesna-probe-fixture-${version}-${Date.now()}`;
  const previous = await readOfflineFixturePointer(cachesApi, origin)
    ?? await readLegacyFixture(cachesApi, fixtureStore, origin);
  if (previous?.cacheName === stagingName) throw new Error('staging cache must differ from the active cache');
  let keepStaging = false;

  try {
    const staging = await cachesApi.open(stagingName);
    for (const url of resources) {
      const response = await fetchImpl(url);
      if (!response || response.ok !== true) throw new Error(`resource download failed: ${url}`);
      await staging.put(resolveCacheRequest(url, origin), response.clone ? response.clone() : response);
    }
    await verifyCachedResources(staging, resources, origin);
    await validateStagedFixture(staging, resources, version, origin);
    await verifyRequiredResources({
      cachesApi,
      resources: requiredResources,
      cacheNames: [stagingName, ...cacheNames.filter((name) => name !== stagingName)],
      origin,
    });

    const record = { version, resources: [...resources], cacheName: stagingName };
    await writeOfflineFixturePointer(cachesApi, record, origin);
    try {
      fixtureStore.publish(record);
    } catch (error) {
      try {
        if (previous) await writeOfflineFixturePointer(cachesApi, previous, origin);
        else await clearOfflineFixturePointer(cachesApi, origin);
      } catch {
        keepStaging = true;
      }
      throw error;
    }
    if (previous?.cacheName && previous.cacheName !== stagingName) {
      try {
        await cachesApi.delete(previous.cacheName);
      } catch {
        // The worker uses the published pointer, so old-cache cleanup is safe to retry later.
      }
    }
    return { ...record, ready: true };
  } catch (error) {
    if (!keepStaging) {
      try {
        await cachesApi.delete(stagingName);
      } catch {
        // Preserve the original download, validation, or publication failure.
      }
    }
    throw error;
  }
}

export function replaceOfflineFixture(options) {
  const fixtureStore = options?.fixtureStore;
  if (!fixtureStore || (typeof fixtureStore !== 'object' && typeof fixtureStore !== 'function')) {
    return Promise.reject(new TypeError('fixture download dependencies are required'));
  }
  return withFixtureLock(fixtureStore, () => replaceOfflineFixtureNow({
    requiredResources: options.resources,
    cacheNames: [],
    fetchImpl: globalThis.fetch,
    ...options,
  }));
}
