import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlaybackStateStore,
  OfflineFixtureStore,
} from '../public/modules/storage.js';

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
