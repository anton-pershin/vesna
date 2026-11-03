export const SHELL_CACHE = 'vesna-probe-shell-v9';
export const SHELL_RESOURCES = [
  '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/sw.js',
  '/modules/timing.js', '/modules/player.js', '/modules/seekbar.js', '/modules/storage.js', '/modules/media-session.js', '/modules/offline.js',
];
export const FIXTURE_RESOURCES = [
  '/fixtures/manifest.json', '/fixtures/text.json', '/fixtures/timings.json', '/fixtures/audio/fixture.mp3',
];
export const REQUIRED_OFFLINE_RESOURCES = [...SHELL_RESOURCES, ...FIXTURE_RESOURCES];

function resolveCacheRequest(url, origin) {
  const base = origin ?? globalThis.location?.origin;
  return base ? new URL(url, base).href : url;
}

async function cachedResponse(cache, url, origin) {
  const response = await cache.match(resolveCacheRequest(url, origin));
  if (!response || response.ok !== true) {
    throw new Error(`offline resource is not cached: ${url}`);
  }
  return response;
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

export async function replaceOfflineFixture({
  version,
  resources,
  fetchImpl = globalThis.fetch,
  cachesApi,
  fixtureStore,
  cacheName,
  requiredResources = resources,
  cacheNames = [],
  origin,
}) {
  if (typeof version !== 'string' || !version || !Array.isArray(resources) || resources.length === 0) {
    throw new TypeError('invalid fixture download');
  }
  if (typeof fetchImpl !== 'function' || !cachesApi || !fixtureStore) {
    throw new TypeError('fixture download dependencies are required');
  }
  const stagingName = cacheName ?? `vesna-probe-fixture-${version}-${Date.now()}`;
  const previous = fixtureStore.read();

  try {
    const staging = await cachesApi.open(stagingName);
    for (const url of resources) {
      const response = await fetchImpl(url);
      if (!response || response.ok !== true) throw new Error(`resource download failed: ${url}`);
      await staging.put(url, response.clone ? response.clone() : response);
    }
    await verifyCachedResources(staging, resources, origin);
    await verifyRequiredResources({
      cachesApi,
      resources: requiredResources,
      cacheNames: [stagingName, ...cacheNames.filter((name) => name !== stagingName)],
      origin,
    });

    const record = { version, resources: [...resources], cacheName: stagingName };
    fixtureStore.publish(record);
    if (previous?.cacheName && previous.cacheName !== stagingName) {
      try {
        await cachesApi.delete(previous.cacheName);
      } catch {
        // Publication is complete; an old cache can be cleaned up later.
      }
    }
    return { ...record, ready: true };
  } catch (error) {
    if (!previous?.cacheName || previous.cacheName !== stagingName) {
      try {
        await cachesApi.delete(stagingName);
      } catch {
        // Preserve the original download or verification failure.
      }
    }
    throw error;
  }
}
