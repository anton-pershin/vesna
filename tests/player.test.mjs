import test from 'node:test';
import assert from 'node:assert/strict';
import { SeekBarController } from '../src/seekbar.js';
import { PlaybackController, restorePlaybackState } from '../src/player.js';

class FakeSlider {
  constructor() {
    this.value = '0';
    this.listeners = new Map();
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  emit(name) {
    this.listeners.get(name)?.({ target: this });
  }
}

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
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  removeEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? [];
    this.listeners.set(name, handlers.filter((candidate) => candidate !== handler));
  }

  get currentTime() { return this._currentTime; }
  set currentTime(value) {
    if (this.readyState < 1) throw new Error('metadata not loaded');
    this._currentTime = value;
    this.emit('seeking');
    this.emit('seeked');
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
    for (const handler of this.listeners.get(name) ?? []) handler();
  }
}

const timings = [
  { id: 'p1', start: 0, end: 10 },
  { id: 'p2', start: 10, end: 20 },
  { id: 'p3', start: 20, end: 30 },
];

test('seekbar seeks as the user moves the slider, without waiting for a release event', () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);
  const slider = new FakeSlider();
  new SeekBarController(slider, audio, player);

  slider.emit('pointerdown');
  slider.value = '24';
  slider.emit('input');

  assert.equal(audio.currentTime, 24);
});

test('seekbar keeps the user-selected value while dragging and commits seek when released', async () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);
  const slider = new FakeSlider();
  const seekbar = new SeekBarController(slider, audio, player);

  await player.seek(15);
  assert.equal(slider.value, '15');
  slider.value = '25';
  slider.emit('pointerdown');
  slider.emit('input');
  audio.currentTime = 17;
  audio.emit('timeupdate');
  assert.equal(slider.value, '25');
  slider.emit('pointerup');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.currentTime, 25);
  assert.equal(slider.value, '25');
});

test('seekbar supports touch dragging and keyboard change events', async () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);
  const slider = new FakeSlider();
  const seekbar = new SeekBarController(slider, audio, player);

  slider.value = '20';
  slider.emit('change');
  await Promise.resolve();
  assert.equal(audio.currentTime, 20);
});

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

test('restore waits for the browser seeked event before completing and publishing the saved position', async () => {
  const audio = new FakeAudio();
  audio.readyState = 0;
  audio.seeking = false;
  Object.defineProperty(audio, 'currentTime', {
    get() { return this._currentTime; },
    set(value) { this._currentTime = value; this.seeking = true; },
  });
  const player = new PlaybackController(audio, timings);
  const restoringStates = [];
  const restore = restorePlaybackState(player, { position: 20, speed: 2 }, (restoring) => {
    restoringStates.push(restoring);
  });

  audio.readyState = 1;
  audio.listeners.set('seeked', []);
  audio.emit('loadedmetadata');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(audio.currentTime, 20);
  assert.deepEqual(restoringStates, [true]);
  assert.equal(audio.listeners.get('seeked').length, 1);

  audio.emit('seeked');
  audio.seeking = false;
  await restore;
  assert.deepEqual(restoringStates, [true, false]);
});

test('restore rejects a no-op seek instead of publishing the saved position', async () => {
  const audio = new FakeAudio();
  Object.defineProperty(audio, 'currentTime', {
    get() { return this._currentTime; },
    set() { this._currentTime = 0; },
  });
  const player = new PlaybackController(audio, timings);

  await assert.rejects(
    restorePlaybackState(player, { position: 20, speed: 2 }),
    /did not reach 20 seconds.*actual 0/,
  );
  assert.equal(audio.currentTime, 0);
});

test('restore rejects seeked when the actual media position does not match the target', async () => {
  const audio = new FakeAudio();
  audio.seeking = false;
  Object.defineProperty(audio, 'currentTime', {
    get() { return this._currentTime; },
    set() { this._currentTime = 0; this.seeking = true; },
  });
  const player = new PlaybackController(audio, timings);
  const restore = restorePlaybackState(player, { position: 20, speed: 2 });

  await new Promise((resolve) => setImmediate(resolve));
  audio.seeking = false;
  audio.emit('seeked');

  await assert.rejects(restore, /did not reach 20 seconds.*actual 0/);
});

test('seek does not clamp a valid position to a transient zero duration', async () => {
  const audio = new FakeAudio();
  audio.duration = 0;
  const player = new PlaybackController(audio, timings);

  await player.seek(20);

  assert.equal(audio.currentTime, 20);
});

test('seek reports a timeout when the browser never completes the seek', async () => {
  const audio = new FakeAudio();
  Object.defineProperty(audio, 'currentTime', {
    get() { return this._currentTime; },
    set(value) { this._currentTime = value; this.seeking = true; },
  });
  const player = new PlaybackController(audio, timings, () => {}, { seekTimeoutMs: 5 });

  await assert.rejects(player.seek(20), /timed out at 20 seconds/);
});

test('seekbar synchronizes the slider when a seek completes', async () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);
  const slider = new FakeSlider();
  const seekbar = new SeekBarController(slider, audio, player);
  audio.seeking = false;
  Object.defineProperty(audio, 'currentTime', {
    get() { return this._currentTime; },
    set(value) { this._currentTime = value; this.seeking = true; },
  });

  const seek = player.seek(20);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slider.value, '0');
  audio.seeking = false;
  audio.emit('seeked');
  await seek;

  assert.equal(slider.value, '20');
  assert.ok(seekbar);
});

test('selecting a paragraph while paused seeks there and starts playback', async () => {
  const audio = new FakeAudio();
  const player = new PlaybackController(audio, timings);

  await player.playFromParagraph('p2');

  assert.equal(audio.currentTime, 10);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.paused, false);
});
