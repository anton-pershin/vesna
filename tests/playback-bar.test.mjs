import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackBarController } from '../public/modules/playback-bar.js';
import { ApplicationController } from '../public/modules/application.js';
import { FakeElement } from './helpers/fake-dom.mjs';

function controls(paused = true) {
  const audio = new FakeElement('audio');
  audio.paused = paused;
  audio.ended = false;
  const button = new FakeElement('button');
  button.append(new FakeElement('use'));
  return { audio, button };
}

test('the playback bar exposes one play/pause toggle with matching icon and accessible state', () => {
  const { audio, button } = controls();
  const bar = new PlaybackBarController({ audio, button, onToggle: async () => {} });
  assert.equal(button.getAttribute('aria-label'), 'Play');
  assert.equal(button.querySelector('use').getAttribute('href'), '#icon-play');
  audio.paused = false;
  audio.dispatch('play');
  assert.equal(button.getAttribute('aria-label'), 'Pause');
  assert.equal(button.querySelector('use').getAttribute('href'), '#icon-pause');
  audio.paused = true;
  audio.dispatch('pause');
  assert.equal(button.getAttribute('aria-label'), 'Play');
  assert.equal(bar.pending, false);
});

test('playback toggles complete without waiting for an actual pending library refresh', async () => {
  const { audio, button } = controls();
  let releaseLibrary;
  const controller = new ApplicationController({
    api: { listItems: () => new Promise((resolve) => { releaseLibrary = resolve; }) },
  });
  controller.authenticated = true;
  const pendingLibraryRefresh = controller.refreshLibrary();
  let toggles = 0;
  const bar = new PlaybackBarController({
    audio,
    button,
    onToggle: async () => {
      toggles += 1;
      audio.paused = !audio.paused;
    },
  });
  await bar.toggle();
  assert.equal(toggles, 1);
  assert.equal(button.getAttribute('aria-label'), 'Pause');
  await bar.toggle();
  assert.equal(toggles, 2);
  assert.equal(button.getAttribute('aria-label'), 'Play');
  assert.equal(button.disabled, false);
  releaseLibrary([]);
  await pendingLibraryRefresh;
});

test('a failed toggle restores the control and reports a safe playback error', async () => {
  const { audio, button } = controls();
  const errors = [];
  const bar = new PlaybackBarController({
    audio,
    button,
    onToggle: async () => { throw new Error('play rejected'); },
    onError: (error) => errors.push(error.message),
  });
  await bar.toggle();
  assert.deepEqual(errors, ['play rejected']);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-label'), 'Play');
});
