import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController, restorePlaybackState } from '../src/player.js';

class FakeAudio {
  constructor() {
    this._currentTime = 0;
    this.readyState = 1;
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

  removeEventListener(name, handler) {
    if (this.listeners.get(name) === handler) this.listeners.delete(name);
  }

  get currentTime() { return this._currentTime; }
  set currentTime(value) {
    if (this.readyState < 1) throw new Error('metadata not loaded');
    this._currentTime = value;
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
  await player.seekToParagraph('p2');
  await player.nextParagraph();
  await player.previousParagraph();
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

test('selecting a paragraph waits for audio metadata before seeking and playing', async () => {
  const audio = new FakeAudio();
  audio.readyState = 0;
  const player = new PlaybackController(audio, timings);

  const selected = player.playFromParagraph('p2');
  assert.equal(audio.playCalls, 0);
  assert.equal(audio.currentTime, 0);

  audio.readyState = 1;
  audio.emit('loadedmetadata');
  await selected;

  assert.equal(audio.currentTime, 10);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.paused, false);
});

test('restore playback state keeps saving suspended until the saved seek completes', async () => {
  const audio = new FakeAudio();
  audio.readyState = 0;
  const player = new PlaybackController(audio, timings);
  const savingStates = [];
  const restoringStates = [];
  const restore = restorePlaybackState(player, { position: 20, speed: 1.5 }, (restoring) => {
    restoringStates.push(restoring);
  });

  assert.deepEqual(restoringStates, [true]);
  savingStates.push(restoringStates.at(-1) ? 'suppressed' : audio.currentTime);
  audio.readyState = 1;
  audio.emit('loadedmetadata');
  await restore;
  savingStates.push(restoringStates.at(-1) ? 'suppressed' : audio.currentTime);

  assert.deepEqual(savingStates, ['suppressed', 20]);
  assert.deepEqual(restoringStates, [true, false]);
  assert.equal(audio.currentTime, 20);
  assert.equal(audio.playbackRate, 1.5);
});

test('selecting a paragraph while paused seeks there and starts playback', async () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);

  await player.playFromParagraph('p2');

  assert.equal(audio.currentTime, 10);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.paused, false);
});
