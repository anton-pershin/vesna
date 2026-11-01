import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../src/player.js';

class FakeAudio {
  constructor() {
    this.currentTime = 0;
    this.duration = 30;
    this.playbackRate = 1;
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.listeners = new Map();
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  async play() {
    this.playCalls += 1;
    this.paused = false;
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }

  emit(name) {
    this.listeners.get(name)?.();
  }
}

const timings = [
  { id: 'p1', start: 0, end: 10 },
  { id: 'p2', start: 10, end: 20 },
  { id: 'p3', start: 20, end: 30 },
];

test('PlaybackController uses one audio element and exposes core controls', async () => {
  const audio = new FakeAudio();
  const active = [];
  const player = new PlaybackController(audio, timings, (id) => active.push(id));

  await player.play();
  player.setSpeed(1.5);
  player.seekToParagraph('p2');
  player.nextParagraph();
  player.previousParagraph();
  player.pause();

  assert.equal(audio.playCalls, 1);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(audio.currentTime, 10);
  assert.deepEqual(active, ['p1', 'p2', 'p3', 'p2']);
});

test('PlaybackController updates the active paragraph after time updates and rejects invalid speed', () => {
  const audio = new FakeAudio();
  const active = [];
  const player = new PlaybackController(audio, timings, (id) => active.push(id));

  audio.currentTime = 20;
  player.handleTimeUpdate();
  assert.equal(player.activeParagraph, 'p3');
  assert.throws(() => player.setSpeed(0), /speed/);
  assert.throws(() => player.setSpeed(3.1), /speed/);
});
