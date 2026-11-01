const PLAYBACK_KEY = 'vesna.playback-state';
const FIXTURE_KEY = 'vesna.offline-fixture';

export class PlaybackStateStore {
  constructor(storage, key = PLAYBACK_KEY) {
    this.storage = storage;
    this.key = key;
  }

  save({ version, position, speed }) {
    if (
      typeof version !== 'string' || !version ||
      !Number.isFinite(position) || position < 0 ||
      !Number.isFinite(speed) || speed <= 0
    ) {
      throw new TypeError('invalid playback state');
    }
    this.storage.setItem(this.key, JSON.stringify({ version, position, speed }));
  }

  load(expectedVersion) {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      throw new Error('invalid playback state');
    }
    if (
      !state || state.version !== expectedVersion ||
      !Number.isFinite(state.position) || !Number.isFinite(state.speed)
    ) {
      throw new Error('unknown playback state version');
    }
    return state;
  }
}

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
    this.storage.setItem(this.key, JSON.stringify({
      version: record.version,
      resources: [...record.resources],
      ready: true,
    }));
  }

  read() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    const fixture = JSON.parse(raw);
    return fixture.ready === true ? fixture : null;
  }
}
