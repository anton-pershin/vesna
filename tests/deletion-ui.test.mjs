import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationController } from '../public/modules/application.js';

const readyItem = (overrides = {}) => ({
  id: 'item-1', kind: 'article', title: 'Story', source_url: 'https://example.test/story',
  filename: null, state: 'ready', error: null, version: 'version-1', paragraph_count: 2,
  ...overrides,
});
const detail = (value) => ({ item: value, paragraphs: [], source_available: false });

function apiWith(overrides = {}) {
  return {
    session: async () => ({ authenticated: true }),
    signIn: async () => null,
    signOut: async () => null,
    listItems: async () => [readyItem()],
    getItem: async (id) => detail(readyItem({ id })),
    submitArticle: async () => readyItem({ state: 'accepted', version: null }),
    uploadMarkdown: async () => readyItem({ kind: 'markdown', state: 'accepted', version: null }),
    retry: async (id) => readyItem({ id }),
    deleteItem: async () => null,
    ...overrides,
  };
}

test('focused screens navigate without discarding library or accepted preparation state', async () => {
  const controller = new ApplicationController({ api: apiWith() });
  assert.equal(controller.screen, 'sign-in');
  await controller.restoreSession();
  assert.equal(controller.screen, 'library');
  controller.showInput();
  assert.equal(controller.screen, 'input');
  controller.closeInput();
  assert.equal(controller.screen, 'library');
  await controller.openItem('item-1');
  assert.equal(controller.screen, 'reader');
  assert.equal(controller.selected.item.id, 'item-1');
  controller.closeItem();
  assert.equal(controller.screen, 'library');
  assert.equal(controller.items.length, 1);
});

test('confirmed deletion clears the selected item and reports local playback cleanup', async () => {
  const cleaned = [];
  const controller = new ApplicationController({
    api: apiWith(),
    onDeleteConfirmed: (itemId) => cleaned.push(itemId),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  await controller.deleteItem('item-1');
  assert.deepEqual(cleaned, ['item-1']);
  assert.deepEqual(controller.items, []);
  assert.equal(controller.selected, null);
  assert.equal(controller.screen, 'library');
  assert.equal(controller.error, null);
  assert.equal(controller.deleteAttempts.size, 0);
});

test('a cleanup failure keeps the reader and permits one explicit sequential retry', async () => {
  let calls = 0;
  const controller = new ApplicationController({
    api: apiWith({
      deleteItem: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error('Cleanup is incomplete');
          error.status = 503;
          throw error;
        }
      },
    }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  await assert.rejects(controller.deleteItem('item-1'), /Cleanup is incomplete/);
  assert.equal(controller.screen, 'reader');
  assert.equal(controller.selected.item.id, 'item-1');
  assert.equal(controller.deletion.status, 'uncertain');
  assert.match(controller.error, /retry|try again/i);
  assert.deepEqual(controller.items, [], 'logical deletion is reflected in the next library');
  await controller.deleteItem('item-1');
  assert.equal(calls, 2);
  assert.equal(controller.screen, 'library');
});

test('unknown and pre-commit failures never produce a deletion success', async () => {
  for (const [status, pattern] of [[404, /not found|no item/i], [500, /unchanged|try again/i]]) {
    const controller = new ApplicationController({
      api: apiWith({
        deleteItem: async () => {
          const error = new Error('Deletion failed');
          error.status = status;
          throw error;
        },
      }),
    });
    await controller.restoreSession();
    await controller.openItem('item-1');
    await assert.rejects(controller.deleteItem('item-1'));
    assert.equal(controller.screen, 'reader');
    assert.equal(controller.selected.item.id, 'item-1');
    assert.match(controller.error, pattern);
    assert.equal(controller.items.length, status === 404 ? 0 : 1);
  }
});

test('a late 401 clears private screens and never restores deleted content', async () => {
  const controller = new ApplicationController({
    api: apiWith({
      deleteItem: async () => {
        const error = new Error('Authentication required');
        error.status = 401;
        throw error;
      },
    }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  await assert.rejects(controller.deleteItem('item-1'));
  assert.equal(controller.authenticated, false);
  assert.equal(controller.screen, 'sign-in');
  assert.equal(controller.selected, null);
  assert.deepEqual(controller.items, []);
});

test('sign-out during deletion ignores rendering but still permits targeted local cleanup', async () => {
  let finish;
  const cleaned = [];
  const controller = new ApplicationController({
    api: apiWith({ deleteItem: () => new Promise((resolve) => { finish = resolve; }) }),
    onDeleteConfirmed: (itemId) => cleaned.push(itemId),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  const deletion = controller.deleteItem('item-1');
  await controller.signOut();
  assert.equal(controller.authenticated, false);
  finish(null);
  await deletion;
  assert.deepEqual(cleaned, ['item-1']);
  assert.equal(controller.screen, 'sign-in');
  assert.equal(controller.selected, null);
  assert.deepEqual(controller.items, []);
});

test('a late cleanup failure after leaving the reader reconciles without blocking the library', async () => {
  let rejectDeletion;
  const controller = new ApplicationController({
    api: apiWith({ deleteItem: () => new Promise((_resolve, reject) => { rejectDeletion = reject; }) }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  const deletion = controller.deleteItem('item-1');
  controller.api.listItems = async () => [];
  controller.closeItem();
  rejectDeletion(Object.assign(new Error('Cleanup is incomplete'), { status: 503 }));
  await assert.rejects(deletion);
  await controller.refreshLibrary();
  assert.equal(controller.screen, 'library');
  assert.equal(controller.deletion, null);
  assert.deepEqual(controller.items, []);
  assert.equal(controller.error, null, 'successful reconciliation clears the earlier error');
});

test('a stale 401 from an old authentication session cannot clear a newer session', async () => {
  let rejectDeletion;
  const controller = new ApplicationController({
    api: apiWith({ deleteItem: () => new Promise((_resolve, reject) => { rejectDeletion = reject; }) }),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  const deletion = controller.deleteItem('item-1');
  await controller.signOut();
  await controller.restoreSession();
  rejectDeletion(Object.assign(new Error('Authentication required'), { status: 401 }));
  await deletion;
  assert.equal(controller.authenticated, true);
  assert.equal(controller.screen, 'library');
  assert.equal(controller.items.length, 1);
});

test('a lost deletion response permits an explicit retry and confirmed cleanup', async () => {
  let calls = 0;
  const cleaned = [];
  const controller = new ApplicationController({
    api: apiWith({
      deleteItem: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Connection lost');
      },
    }),
    onDeleteConfirmed: (itemId) => cleaned.push(itemId),
  });
  await controller.restoreSession();
  await controller.openItem('item-1');
  await assert.rejects(controller.deleteItem('item-1'), /Connection lost/);
  assert.equal(controller.deletion.status, 'uncertain');
  await controller.deleteItem('item-1');
  assert.equal(calls, 2);
  assert.deepEqual(cleaned, ['item-1']);
  assert.equal(controller.screen, 'library');
});

test('a pre-deletion item-detail response cannot reopen a deleted item', async () => {
  let releaseDetail;
  const controller = new ApplicationController({
    api: apiWith({ getItem: () => new Promise((resolve) => { releaseDetail = resolve; }) }),
  });
  controller.authenticated = true;
  controller.screen = 'library';
  controller.items = [readyItem()];
  const opening = controller.openItem('item-1');
  await controller.deleteItem('item-1');
  releaseDetail(detail(readyItem()));
  assert.equal(await opening, null);
  assert.equal(controller.selected, null);
  assert.equal(controller.screen, 'library');
  assert.deepEqual(controller.items, []);
});

test('deleting item A does not cancel an in-flight opening of item B', async () => {
  let releaseDelete;
  let releaseB;
  const controller = new ApplicationController({
    api: apiWith({
      listItems: async () => [readyItem({ id: 'a' }), readyItem({ id: 'b', title: 'Other' })],
      getItem: (id) => id === 'b'
        ? new Promise((resolve) => { releaseB = resolve; })
        : Promise.resolve(detail(readyItem({ id }))),
      deleteItem: () => new Promise((resolve) => { releaseDelete = resolve; }),
    }),
  });
  await controller.restoreSession();
  await controller.openItem('a');
  const deletion = controller.deleteItem('a');
  controller.closeItem();
  const openingB = controller.openItem('b');
  releaseDelete(null);
  await deletion;
  releaseB(detail(readyItem({ id: 'b', title: 'Other' })));
  assert.equal((await openingB).item.id, 'b');
  assert.equal(controller.selected.item.id, 'b');
  assert.equal(controller.screen, 'reader');
  assert.deepEqual(controller.items.map((entry) => entry.id), ['b']);
});

test('a pre-deletion library response cannot reinsert a deleted item', async () => {
  let release;
  const controller = new ApplicationController({
    api: apiWith({ listItems: () => new Promise((resolve) => { release = resolve; }) }),
  });
  controller.authenticated = true;
  controller.screen = 'reader';
  controller.items = [readyItem()];
  controller.selected = detail(readyItem());
  const refresh = controller.refreshLibrary();
  await controller.deleteItem('item-1');
  release([readyItem()]);
  await refresh;
  assert.deepEqual(controller.items, []);
  assert.equal(controller.selected, null);
  assert.equal(controller.screen, 'library');
});
