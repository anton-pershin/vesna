const PLAYBACK_KEY = 'vesna.playback-state';
const ITEM_PLAYBACK_KEY = 'vesna.prepared-playback-state';

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

export class ItemPlaybackStateStore {
  constructor(storage, prefix = ITEM_PLAYBACK_KEY) {
    this.storage = storage;
    this.prefix = prefix;
  }

  key(itemId, version) {
    if (typeof itemId !== 'string' || !itemId || typeof version !== 'string' || !version) {
      throw new TypeError('item ID and prepared version are required');
    }
    return `${this.prefix}:${encodeURIComponent(itemId)}:${encodeURIComponent(version)}`;
  }

  save({ itemId, version, position, speed }) {
    if (
      !Number.isFinite(position) || position < 0 ||
      !Number.isFinite(speed) || speed <= 0
    ) {
      throw new TypeError('invalid playback state');
    }
    this.storage.setItem(this.key(itemId, version), JSON.stringify({
      itemId, version, position, speed,
    }));
  }

  load(itemId, version) {
    const raw = this.storage.getItem(this.key(itemId, version));
    if (!raw) return null;
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      throw new Error('invalid playback state');
    }
    if (
      !state || state.itemId !== itemId || state.version !== version ||
      !Number.isFinite(state.position) || state.position < 0 ||
      !Number.isFinite(state.speed) || state.speed <= 0
    ) {
      throw new Error('unknown item playback state version');
    }
    return state;
  }
}
