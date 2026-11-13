import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../public/modules/player.js';
import { SeekBarController } from '../public/modules/seekbar.js';
import { renderParagraphs, setCurrentParagraph } from '../public/modules/views.js';
import { FakeDocument } from './helpers/fake-dom.mjs';

class FakeAudio {
  constructor() {
    this.currentTime = 0;
    this.duration = 9;
    this.readyState = 1;
    this.playbackRate = 1;
    this.paused = true;
    this.listeners = new Map();
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== handler));
  }

  emit(name) {
    for (const handler of [...(this.listeners.get(name) ?? [])]) handler({ target: this });
  }

  async play() { this.paused = false; }
  pause() { this.paused = true; }
}

class FakeSlider {
  constructor() {
    this.value = '0';
    this.listeners = new Map();
  }

  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== handler));
  }

  emit(name) {
    for (const handler of [...(this.listeners.get(name) ?? [])]) handler({ target: this });
  }
}

const articleTimings = [{ id: 'article-only', start: 0, end: 9 }];
const markdownTimings = [
  { id: 'markdown-first', start: 0, end: 4 },
  { id: 'markdown-second', start: 4, end: 9 },
];

test('article A to Markdown B to restored article A cannot lose its highlight to stale controllers', async () => {
  const audio = new FakeAudio();
  const container = new FakeDocument().createElement('ol');
  const documentImpl = new FakeDocument();
  const options = { documentImpl, ready: true, onSelect: () => {} };

  renderParagraphs(container, [{ id: 'article-only', text: 'Article paragraph' }], options);
  const firstArticle = new PlaybackController(audio, articleTimings, (id) => {
    setCurrentParagraph(container, id);
  });
  assert.equal(container.querySelector('li').className.includes('current'), true);
  firstArticle.destroy();

  renderParagraphs(container, [
    { id: 'markdown-first', text: 'Markdown first' },
    { id: 'markdown-second', text: 'Markdown second' },
  ], options);
  const markdown = new PlaybackController(audio, markdownTimings, (id) => {
    setCurrentParagraph(container, id);
  });
  audio.currentTime = 2;
  audio.emit('timeupdate');
  markdown.destroy();

  renderParagraphs(container, [{ id: 'article-only', text: 'Article paragraph' }], options);
  const restoredArticle = new PlaybackController(audio, articleTimings, (id) => {
    setCurrentParagraph(container, id);
  });
  await restoredArticle.seek(4);
  assert.equal(container.querySelector('li').className.includes('current'), true);

  audio.currentTime = 5;
  audio.emit('timeupdate');
  assert.equal(container.querySelector('li').className.includes('current'), true);
  assert.equal(container.querySelector('button').getAttribute('aria-current'), 'true');
  assert.equal(container.querySelector('.current-marker').hidden, false);
  assert.equal(audio.listeners.get('timeupdate').length, 1, 'only the active controller remains subscribed');
  await assert.rejects(markdown.play(), /no longer active/);
  restoredArticle.destroy();
});

test('destroying a seekbar removes slider and audio subscriptions and blocks later commits', () => {
  const audio = new FakeAudio();
  const slider = new FakeSlider();
  const player = new PlaybackController(audio, articleTimings);
  const seekbar = new SeekBarController(slider, audio, player);
  seekbar.destroy();

  slider.value = '8';
  slider.emit('input');
  audio.currentTime = 6;
  audio.emit('timeupdate');
  assert.equal(audio.currentTime, 6);
  assert.equal(slider.value, '8');
  assert.equal(slider.listeners.get('input').length, 0);
  assert.equal(audio.listeners.get('timeupdate').length, 1, 'only the player remains');
  player.destroy();
  assert.equal(audio.listeners.get('timeupdate').length, 0);
});
