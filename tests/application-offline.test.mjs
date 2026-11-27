import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationController } from '../public/modules/application.js';

const ready = (overrides = {}) => ({
  id: 'item-1', kind: 'article', title: 'Downloaded story', source_url: 'https://example.test/story',
  filename: null, state: 'ready', error: null, version: 'version-1', paragraph_count: 1,
  download: { status: 'ready', version: 'version-1', persistent: true },
  ...overrides,
});

function api(overrides = {}) {
  return {
    session: async () => ({ authenticated: true }),
    signIn: async () => null,
    signOut: async () => null,
    listItems: async () => [ready({ download: undefined })],
    getItem: async (id) => ({ item: ready({ id, download: undefined }), paragraphs: [], source_available: false }),
    submitArticle: async () => { throw new Error('must not submit offline'); },
    uploadMarkdown: async () => { throw new Error('must not upload offline'); },
    retry: async () => { throw new Error('must not retry offline'); },
    deleteItem: async () => { throw new Error('must not delete offline'); },
    ...overrides,
  };
}

function downloads(overrides = {}) {
  const downloaded = ready();
  return {
    list: async () => [downloaded],
    get: async (id) => ({ item: ready({ id }), paragraphs: [], source_available: false }),
    reconcile: async (items) => items.map((item) => ({ ...item, download: downloaded.download })),
    download: async (item) => ({ item, download: { status: 'ready', version: item.version, persistent: true }, warning: null }),
    remove: async () => true,
    ...overrides,
  };
}

test('a network-disabled startup opens only the downloaded library without server reads', async () => {
  let libraryCalls = 0;
  const reasons = [];
  const controller = new ApplicationController({
    api: api({
      session: async () => { throw new TypeError('Failed to fetch'); },
      listItems: async () => { libraryCalls += 1; return []; },
      getItem: async () => { throw new Error('server item read'); },
    }),
    downloads: downloads(),
    onChange: (_state, reason) => reasons.push(reason),
  });
  assert.equal(await controller.restoreSession(), true);
  assert.equal(controller.authenticated, true);
  assert.equal(controller.offline, true);
  assert.equal(controller.screen, 'library');
  assert.equal(controller.items[0].title, 'Downloaded story');
  assert.equal(libraryCalls, 0);
  assert.deepEqual(reasons, ['offline-library']);
  await controller.openItem('item-1');
  assert.equal(controller.selected.item.version, 'version-1');
  assert.equal(controller.selected.source_available, false);
  await assert.rejects(controller.submitArticle('https://example.test'), /Connect to the Internet/);
  await assert.rejects(controller.retry('item-1'), /Connect to the Internet/);
  await assert.rejects(controller.deleteItem('item-1'), /Connect to the Internet/);
});

test('offline startup with no downloads requests connection instead of showing a false library', async () => {
  const controller = new ApplicationController({
    api: api({ session: async () => { throw new TypeError('offline'); } }),
    downloads: downloads({ list: async () => [] }),
  });
  assert.equal(await controller.restoreSession(), false);
  assert.equal(controller.authenticated, false);
  assert.equal(controller.offline, false);
  assert.match(controller.error, /No offline downloads/);
});

test('an online 401 never unlocks device downloads', async () => {
  let localReads = 0;
  const controller = new ApplicationController({
    api: api({ session: async () => { const error = new Error('Authentication required'); error.status = 401; throw error; } }),
    downloads: downloads({ list: async () => { localReads += 1; return [ready()]; } }),
  });
  assert.equal(await controller.restoreSession(), false);
  assert.equal(controller.authenticated, false);
  assert.equal(localReads, 0);
  assert.equal(controller.error, null);
});

test('online reconciliation attaches local state without replacing the server version', async () => {
  const controller = new ApplicationController({
    api: api(),
    downloads: downloads({
      reconcile: async (items) => items.map((item) => ({
        ...item,
        version: 'version-2',
        download: { status: 'update-available', version: 'version-1', persistent: true },
      })),
    }),
  });
  await controller.restoreSession();
  assert.equal(controller.offline, false);
  assert.equal(controller.items[0].version, 'version-2');
  assert.equal(controller.items[0].download.version, 'version-1');
  await controller.openItem('item-1');
  assert.equal(controller.selected.item.download.status, 'update-available');
});

test('a repeated download action shares the operation and publishes returned state', async () => {
  let release;
  let calls = 0;
  const controller = new ApplicationController({
    api: api(),
    downloads: downloads({
      download: async (item) => {
        calls += 1;
        await new Promise((resolve) => { release = resolve; });
        return {
          item,
          download: { status: 'ready', version: item.version, persistent: false },
          warning: 'The browser may remove this download.',
        };
      },
    }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  const first = controller.downloadItem('item-1');
  const second = controller.downloadItem('item-1');
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(controller.selected.item.download.status, 'ready');
  assert.equal(controller.selected.item.download.persistent, false);
  assert.match(controller.error, /may remove/);
});

test('offline removal updates the library without a server deletion', async () => {
  const removed = [];
  const controller = new ApplicationController({
    api: api({ session: async () => { throw new TypeError('offline'); } }),
    downloads: downloads({
      remove: async (id) => { removed.push(id); return true; },
      list: async () => [ready()],
      get: async (id) => ({ item: ready({ id }), paragraphs: [], source_available: false }),
    }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  await controller.removeDownload('item-1');
  assert.deepEqual(removed, ['item-1']);
  assert.deepEqual(controller.items, []);
  assert.equal(controller.selected, null);
  assert.equal(controller.screen, 'library');
  assert.equal(controller.offline, true);
});
