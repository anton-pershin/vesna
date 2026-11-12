import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationController } from '../public/modules/application.js';

const item = (overrides = {}) => ({
  id: 'item-1',
  kind: 'article',
  title: 'Story',
  source_url: 'https://example.test/story',
  filename: null,
  state: 'accepted',
  error: null,
  version: null,
  paragraph_count: 0,
  ...overrides,
});

const detail = (value) => ({ item: value, paragraphs: [], source_available: false });

function timers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    setIntervalImpl(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearIntervalImpl(id) { callbacks.delete(id); },
    async run(id = 1) {
      await callbacks.get(id)?.();
    },
  };
}

function apiWith(overrides = {}) {
  return {
    session: async () => ({ authenticated: true }),
    signIn: async () => null,
    signOut: async () => null,
    listItems: async () => [],
    getItem: async (id) => detail(item({ id })),
    submitArticle: async () => item(),
    uploadMarkdown: async () => item({ kind: 'markdown' }),
    retry: async (id) => item({ id }),
    ...overrides,
  };
}

test('an unauthenticated session check does not read private library data', async () => {
  let libraryCalls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      session: async () => { const error = new Error('Authentication required'); error.status = 401; throw error; },
      listItems: async () => { libraryCalls += 1; return []; },
    }),
  });
  assert.equal(await controller.restoreSession(), false);
  assert.equal(controller.authenticated, false);
  assert.equal(libraryCalls, 0);
  assert.equal(controller.error, null);
});

test('a session response must explicitly confirm authentication', async () => {
  let libraryCalls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      session: async () => ({ authenticated: false }),
      listItems: async () => { libraryCalls += 1; return []; },
    }),
  });
  assert.equal(await controller.restoreSession(), false);
  assert.equal(controller.authenticated, false);
  assert.equal(libraryCalls, 0);
});

test('a rejected password shows the safe sign-in error without a session-expiry message', async () => {
  const controller = new ApplicationController({
    api: apiWith({
      signIn: async () => {
        const error = new Error('Invalid password');
        error.status = 401;
        throw error;
      },
    }),
  });
  await assert.rejects(controller.signIn('wrong'), /Invalid password/);
  assert.equal(controller.authenticated, false);
  assert.equal(controller.error, 'Invalid password');
});

test('accepted items start polling and ready items stop it without duplicate refreshes', async () => {
  const clock = timers();
  let current = item();
  let listCalls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => { listCalls += 1; return [current]; },
    }),
    ...clock,
  });

  await controller.signIn('ephemeral');
  assert.equal(controller.authenticated, true);
  assert.equal(listCalls, 1);
  assert.equal(clock.callbacks.size, 1);

  current = item({ state: 'preparing' });
  await clock.run();
  assert.equal(controller.items[0].state, 'preparing');
  assert.equal(clock.callbacks.size, 1);

  current = item({ state: 'ready', version: 'version-1' });
  await clock.run();
  assert.equal(controller.items[0].state, 'ready');
  assert.equal(clock.callbacks.size, 0);
});

test('concurrent library refreshes share one API operation', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => { calls += 1; await gate; return []; },
    }),
  });
  controller.authenticated = true;
  const first = controller.refreshLibrary();
  const second = controller.refreshLibrary();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('browser timer wrappers preserve the required global receiver', () => {
  let receiver;
  const controller = new ApplicationController({
    api: apiWith(),
    setIntervalImpl: function () { receiver = this; return 1; },
    clearIntervalImpl() {},
  });
  controller.authenticated = true;
  controller.screen = 'library';
  controller.items = [item()];
  controller.syncPolling();
  assert.equal(receiver, globalThis);
});

test('pending submissions share one operation and open the accepted item', async () => {
  let release;
  let calls = 0;
  let acceptedItems = [];
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => acceptedItems,
      submitArticle: async () => {
        calls += 1;
        await new Promise((resolve) => { release = resolve; });
        acceptedItems = [item({ id: 'accepted-item', state: 'accepted' })];
        return acceptedItems[0];
      },
    }),
  });
  await controller.restoreSession();
  const first = controller.submitArticle('https://example.test/story');
  const second = controller.submitArticle('https://example.test/story');
  release();
  const [accepted] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(accepted.id, 'accepted-item');
  assert.equal(controller.items.filter((entry) => entry.id === accepted.id).length, 1);
  await controller.openItem(accepted.id);
  assert.equal(controller.selected.item.id, accepted.id);
  assert.equal(controller.screen, 'reader');
  controller.stopPolling();
});

test('a distinct submission cannot be coalesced with a pending article', async () => {
  let release;
  let acceptedItems = [];
  let articleCalls = 0;
  let markdownCalls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => acceptedItems,
      submitArticle: async () => {
        articleCalls += 1;
        await new Promise((resolve) => { release = resolve; });
        acceptedItems = [item({ id: 'article-result', state: 'accepted' })];
        return acceptedItems[0];
      },
      uploadMarkdown: async () => {
        markdownCalls += 1;
        return item({ id: 'markdown-result', kind: 'markdown', state: 'accepted' });
      },
    }),
  });
  await controller.restoreSession();
  const article = controller.submitArticle('https://example.test/story');
  await assert.rejects(
    controller.uploadMarkdown({ name: 'different.md' }),
    /Another submission is already in progress/,
  );
  assert.equal(markdownCalls, 0);
  release();
  assert.equal((await article).id, 'article-result');
  await controller.uploadMarkdown({ name: 'different.md' });
  assert.equal(articleCalls, 1);
  assert.equal(markdownCalls, 1);
  controller.stopPolling();
});

test('retry keeps one library item and resumes preparation polling', async () => {
  const clock = timers();
  let current = item({ state: 'failed', error: 'Known failure' });
  let retryCalls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => [current],
      retry: async (id) => {
        retryCalls += 1;
        current = item({ id, state: 'accepted' });
        return current;
      },
    }),
    ...clock,
  });
  await controller.restoreSession();
  assert.equal(clock.callbacks.size, 0, 'failed items do not continuously poll');

  await controller.retry('item-1');
  assert.equal(retryCalls, 1);
  assert.equal(controller.items.length, 1);
  assert.equal(controller.items[0].id, 'item-1');
  assert.equal(controller.items[0].state, 'accepted');
  assert.equal(clock.callbacks.size, 1);
});

test('opening and refreshing an item preserves detail and polls until ready', async () => {
  const clock = timers();
  let current = item({ state: 'preparing', paragraph_count: 1 });
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => [current],
      getItem: async () => detail(current),
    }),
    ...clock,
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  assert.equal(controller.selected.item.id, 'item-1');

  current = item({ state: 'ready', version: 'version-1', paragraph_count: 1 });
  await clock.run();
  assert.equal(controller.selected.item.state, 'ready');
  assert.equal(controller.selected.item.version, 'version-1');
  assert.equal(clock.callbacks.size, 0);
});

test('a 401 clears private items and stops polling', async () => {
  const clock = timers();
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => [item()],
    }),
    ...clock,
  });
  await controller.restoreSession();
  controller.selected = detail(item());
  assert.equal(clock.callbacks.size, 1);
  controller.api.listItems = async () => {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  };

  await clock.run();
  assert.equal(controller.authenticated, false);
  assert.deepEqual(controller.items, []);
  assert.equal(controller.selected, null);
  assert.equal(clock.callbacks.size, 0);
  assert.match(controller.error, /session has expired/);
});

test('sign-out clears selected private content even if the server operation fails', async () => {
  const controller = new ApplicationController({
    api: apiWith({ signOut: async () => { throw new Error('offline'); } }),
  });
  await controller.restoreSession();
  controller.selected = detail(item());
  await assert.rejects(controller.signOut(), /offline/);
  assert.equal(controller.authenticated, false);
  assert.deepEqual(controller.items, []);
  assert.equal(controller.selected, null);
});
