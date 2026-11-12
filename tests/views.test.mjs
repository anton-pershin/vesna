import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument, FakeElement } from './helpers/fake-dom.mjs';
import {
  renderLibrary,
  renderParagraphs,
  setArticleLink,
  setCurrentParagraph,
} from '../public/modules/views.js';

const summary = (overrides = {}) => ({
  id: 'item-1',
  kind: 'article',
  title: 'A story',
  source_url: 'https://example.test/story',
  filename: null,
  state: 'preparing',
  error: null,
  version: null,
  paragraph_count: 0,
  ...overrides,
});

test('library renders untrusted values as text and exposes state, open, and retry actions', () => {
  const documentImpl = new FakeDocument();
  const container = new FakeElement('ul');
  const opened = [];
  const retried = [];
  const hostile = '<img src=x onerror=alert(1)>';
  renderLibrary(container, [
    summary({ title: hostile }),
    summary({ id: 'item-2', kind: 'markdown', title: null, filename: hostile, state: 'failed', error: hostile }),
    summary({ id: 'item-3', state: 'ready', version: 'version-1' }),
  ], {
    documentImpl,
    onOpen: (id) => opened.push(id),
    onRetry: (id) => retried.push(id),
  });

  assert.equal(container.children.length, 3);
  assert.equal(container.querySelector('img'), null, 'no untrusted element is constructed');
  assert.match(container.children[0].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(container.children[0].textContent, /Preparing…/);
  assert.match(container.children[1].textContent, /Preparation failed/);
  assert.match(container.children[2].textContent, /Ready to listen/);
  assert.doesNotMatch(container.children[0].textContent, /Ready to listen/);

  container.children[0].querySelector('button').dispatch('click');
  const retry = container.children[1].querySelector('.secondary-button');
  assert.equal(retry.textContent, 'Retry');
  retry.dispatch('click');
  assert.deepEqual(opened, ['item-1']);
  assert.deepEqual(retried, ['item-2']);
});

test('library state transitions preserve the focused item action', () => {
  const documentImpl = new FakeDocument();
  const container = new FakeElement('ul');
  const current = [summary({ state: 'preparing' })];
  renderLibrary(container, current, { documentImpl, onOpen: () => {}, onRetry: () => {} });
  documentImpl.activeElement = container.querySelector('button');
  current[0] = summary({ state: 'ready', version: 'version-1' });
  renderLibrary(container, current, { documentImpl, onOpen: () => {}, onRetry: () => {} });
  const replacement = container.querySelector('button');
  assert.notEqual(replacement, documentImpl.activeElement, 'the focused button is replaced');
  assert.deepEqual(replacement.focusCalls, [{ preventScroll: true }]);
  assert.equal(replacement.dataset.itemId, 'item-1');
  assert.equal(replacement.dataset.libraryAction, 'open');
});

test('retry acceptance moves focus to the item open action when retry disappears', () => {
  const documentImpl = new FakeDocument();
  const container = new FakeElement('ul');
  renderLibrary(container, [summary({ state: 'failed' })], { documentImpl, onOpen: () => {}, onRetry: () => {} });
  documentImpl.activeElement = container.querySelector('.secondary-button');
  assert.equal(documentImpl.activeElement.dataset.libraryAction, 'retry');
  renderLibrary(container, [summary({ state: 'accepted' })], { documentImpl, onOpen: () => {}, onRetry: () => {} });
  const open = container.querySelector('button');
  assert.equal(open.dataset.libraryAction, 'open');
  assert.deepEqual(open.focusCalls, [{ preventScroll: true }]);
});

test('paragraph selection has labelled controls and a non-color current indication', () => {
  const documentImpl = new FakeDocument();
  const container = new FakeElement('ol');
  const selected = [];
  renderParagraphs(container, [
    { id: 'p0', text: '<script>alert(1)</script>' },
    { id: 'p1', text: 'Second paragraph' },
  ], { documentImpl, ready: true, onSelect: (id) => selected.push(id) });

  const first = container.children[0];
  const second = container.children[1];
  assert.equal(first.querySelector('script'), null);
  assert.equal(first.querySelector('button').getAttribute('aria-label'), 'Play from paragraph 1');
  assert.equal(first.querySelector('.current-marker').hidden, true);

  setCurrentParagraph(container, 'p1', { autoScroll: true });
  assert.equal(first.className.includes('current'), false);
  assert.equal(second.className.includes('current'), true);
  assert.equal(second.querySelector('button').getAttribute('aria-current'), 'true');
  assert.equal(second.querySelector('.current-marker').hidden, false);
  assert.match(second.textContent, /Current paragraph/);
  assert.deepEqual(second.scrollCalls, [{ block: 'nearest' }]);

  second.querySelector('button').dispatch('click');
  assert.deepEqual(selected, ['p1']);
});

test('paragraphs are inspectable but not playable before ready', () => {
  const container = new FakeElement('ol');
  renderParagraphs(container, [{ id: 'p0', text: 'Source text' }], {
    documentImpl: new FakeDocument(),
    ready: false,
    onSelect: () => assert.fail('not selectable'),
  });
  const button = container.querySelector('button');
  assert.equal(button.disabled, true);
  assert.match(button.getAttribute('aria-label'), /not ready/);
  assert.equal(container.textContent.includes('Source text'), true);
});

test('article links allow only HTTP and HTTPS destinations', () => {
  const anchor = new FakeElement('a');
  setArticleLink(anchor, 'javascript:alert(1)');
  assert.equal(anchor.hidden, true);
  assert.equal(anchor.getAttribute('href'), null);
  setArticleLink(anchor, 'https://user:password@example.test/story');
  assert.equal(anchor.hidden, true);
  assert.equal(anchor.getAttribute('href'), null);
  setArticleLink(anchor, 'https://example.test/story');
  assert.equal(anchor.hidden, false);
  assert.equal(anchor.href, 'https://example.test/story');
});
