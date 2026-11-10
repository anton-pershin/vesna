import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlaybackStateStore,
  ItemPlaybackStateStore,
} from '../public/modules/storage.js';
import { OfflineFixtureStore } from '../probe/modules/offline-store.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test('PlaybackStateStore restores position, speed, and fixture version', () => {
  const storage = new MemoryStorage();
  const state = new PlaybackStateStore(storage);
  state.save({ version: 'fixture-v1', position: 42.5, speed: 1.25 });
  assert.deepEqual(state.load('fixture-v1'), {
    version: 'fixture-v1', position: 42.5, speed: 1.25,
  });
});

test('PlaybackStateStore rejects unknown or invalid fixture versions', () => {
  const storage = new MemoryStorage();
  const state = new PlaybackStateStore(storage);
  state.save({ version: 'fixture-v1', position: 3, speed: 1 });
  assert.throws(() => state.load('fixture-v2'), /version/);
  storage.setItem('vesna.playback-state', '{bad');
  assert.throws(() => state.load('fixture-v1'), /state/);
});

test('ItemPlaybackStateStore isolates positions by item and prepared version', () => {
  const storage = new MemoryStorage();
  const states = new ItemPlaybackStateStore(storage);
  states.save({ itemId: 'item-a', version: 'version-1', position: 12, speed: 1 });
  states.save({ itemId: 'item-a', version: 'version-2', position: 34, speed: 1.5 });
  states.save({ itemId: 'item-b', version: 'version-1', position: 56, speed: 0.75 });

  assert.equal(states.load('item-a', 'version-1').position, 12);
  assert.equal(states.load('item-a', 'version-2').position, 34);
  assert.equal(states.load('item-b', 'version-1').position, 56);
  assert.equal(states.load('item-b', 'version-2'), null);
  assert.equal(storage.values.size, 3);
});

test('ItemPlaybackStateStore rejects invalid or mismatched saved state without overwriting it', () => {
  const storage = new MemoryStorage();
  const states = new ItemPlaybackStateStore(storage);
  states.save({ itemId: 'item-a', version: 'version-1', position: 42, speed: 1.25 });
  const key = states.key('item-a', 'version-1');
  const mismatched = JSON.stringify({ itemId: 'item-b', version: 'version-1', position: 0, speed: 1 });
  storage.setItem(key, mismatched);
  assert.throws(() => states.load('item-a', 'version-1'), /version/);
  assert.equal(storage.getItem(key), mismatched, 'loading does not overwrite stored state');

  storage.setItem(key, '{bad');
  assert.throws(() => states.load('item-a', 'version-1'), /invalid playback state/);
  assert.equal(storage.getItem(key), '{bad');
});

test('ItemPlaybackStateStore rejects negative positions and non-positive speeds', () => {
  const states = new ItemPlaybackStateStore(new MemoryStorage());
  assert.throws(() => states.save({ itemId: 'a', version: 'v', position: -1, speed: 1 }), /invalid/);
  assert.throws(() => states.save({ itemId: 'a', version: 'v', position: 0, speed: 0 }), /invalid/);
  assert.throws(() => states.save({ itemId: '', version: 'v', position: 0, speed: 1 }), /required/);
});

test('OfflineFixtureStore publishes complete replacements atomically', () => {
  const storage = new MemoryStorage();
  const fixtures = new OfflineFixtureStore(storage);
  const first = { version: 'fixture-v1', resources: ['text', 'timings', 'audio'] };
  fixtures.publish(first);
  assert.deepEqual(fixtures.read(), { ...first, ready: true });

  assert.throws(
    () => fixtures.publish({ version: 'fixture-v2', resources: ['text'], complete: false }),
    /complete/,
  );
  assert.deepEqual(fixtures.read(), { ...first, ready: true });
});
