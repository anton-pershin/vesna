const FIXTURE_KEY = 'vesna.offline-fixture';

export class OfflineFixtureStore {
  constructor(storage, key = FIXTURE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  publish(record) {
    if (
      !record || record.complete === false ||
      typeof record.version !== 'string' || !record.version ||
      !Array.isArray(record.resources) || record.resources.length < 3
    ) {
      throw new Error('fixture is not complete');
    }
    const published = {
      version: record.version,
      resources: [...record.resources],
      ready: true,
    };
    if (typeof record.cacheName === 'string' && record.cacheName) published.cacheName = record.cacheName;
    this.storage.setItem(this.key, JSON.stringify(published));
  }

  read() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    const fixture = JSON.parse(raw);
    return fixture.ready === true ? fixture : null;
  }
}
