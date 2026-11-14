import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, VesnaApi } from '../public/modules/api.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('authentication calls use documented same-origin credentialed routes without Web Storage', async (t) => {
  const calls = [];
  const api = new VesnaApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/auth/session') return jsonResponse({ authenticated: true });
      return new Response(null, { status: 204 });
    },
  });
  for (const name of ['localStorage', 'sessionStorage']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: new Proxy({}, {
        get() { throw new Error(`authentication must not access ${name}`); },
      }),
    });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }

  await api.signIn('not-a-real-password');
  assert.equal(await api.session().then((result) => result.authenticated), true);
  await api.signOut();

  assert.deepEqual(calls.map((call) => [call.url, call.options.method || 'GET']), [
    ['/api/auth/sign-in', 'POST'],
    ['/api/auth/session', 'GET'],
    ['/api/auth/sign-out', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { password: 'not-a-real-password' });
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.get('Accept'), 'application/json');
  }
});

test('build identity uses a public no-store API operation and validates the response', async () => {
  const calls = [];
  const api = new VesnaApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ commit: 'c07b026-test-build' });
    },
  });
  assert.equal(await api.build(), 'c07b026-test-build');
  assert.equal(calls[0].url, '/api/build');
  assert.equal(calls[0].options.cache, 'no-store');
  const invalid = new VesnaApi({ fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(invalid.build(), /Invalid build response/);
});

test('article and Markdown submissions use only their JSON and multipart API operations', async () => {
  const calls = [];
  class FakeFormData {
    constructor() { this.fields = []; }
    append(...args) { this.fields.push(args); }
  }
  const file = { name: 'article.md' };
  const api = new VesnaApi({
    FormDataImpl: FakeFormData,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ id: 'returned-item', state: 'accepted' }, 202);
    },
  });

  await api.submitArticle('https://example.test/story?x=1');
  await api.uploadMarkdown(file);

  assert.equal(calls[0].url, '/api/items/article');
  assert.deepEqual(JSON.parse(calls[0].options.body), { url: 'https://example.test/story?x=1' });
  assert.equal(calls[0].options.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].url, '/api/items/markdown');
  assert.equal(calls[1].options.headers.get('Content-Type'), null);
  assert.deepEqual(calls[1].options.body.fields, [['file', file]]);
  assert.equal(calls.length, 2, 'upload does not retrieve linked resources');
});

test('library, detail, retry, source, and prepared artifact routes use returned IDs', async () => {
  const calls = [];
  const api = new VesnaApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/source')) return new Response('# Original');
      if (url === '/api/items') return jsonResponse({ items: [] });
      return jsonResponse({ version: 'version/two', paragraphs: [], timings: [] });
    },
  });

  await api.listItems();
  await api.getItem('item/one');
  await api.retry('item/one');
  await api.getText('item/one', 'version/two');
  await api.getTimings('item/one', 'version/two');
  assert.equal(await api.getSourceText('item/one'), '# Original');
  assert.equal(api.audioUrl('item/one', 'version/two'),
    '/api/items/item%2Fone/versions/version%2Ftwo/audio');

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/items',
    '/api/items/item%2Fone',
    '/api/items/item%2Fone/retry',
    '/api/items/item%2Fone/versions/version%2Ftwo/text',
    '/api/items/item%2Fone/versions/version%2Ftwo/timings',
    '/api/items/item%2Fone/source',
  ]);
  assert.equal(calls.at(-1).options.credentials, 'same-origin');
  assert.equal(calls.at(-1).options.cache, 'no-store');
});

test('item deletion uses the authenticated same-origin DELETE operation and accepts 204', async () => {
  const calls = [];
  const api = new VesnaApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await api.deleteItem('item/one'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/items/item%2Fone');
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('API calls preserve the global receiver required by native fetch', async () => {
  const receivers = [];
  const api = new VesnaApi({
    fetchImpl: async function () {
      receivers.push(this);
      return jsonResponse({ authenticated: true });
    },
  });
  await api.session();
  assert.deepEqual(receivers, [globalThis]);
});

test('API errors expose safe server detail and status', async () => {
  const api = new VesnaApi({
    fetchImpl: async () => jsonResponse({ detail: 'Preparation failed safely' }, 409),
  });
  await assert.rejects(api.retry('item-1'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, 'Preparation failed safely');
    assert.equal(error.status, 409);
    return true;
  });
});

test('invalid success payloads and malformed error payloads become explicit errors', async (t) => {
  await t.test('invalid library', async () => {
    const api = new VesnaApi({ fetchImpl: async () => jsonResponse({ items: null }) });
    await assert.rejects(api.listItems(), /Invalid library response/);
  });
  await t.test('invalid JSON', async () => {
    const api = new VesnaApi({ fetchImpl: async () => new Response('not json', { status: 200 }) });
    await assert.rejects(api.session(), /invalid response/);
  });
  await t.test('non-JSON failure', async () => {
    const api = new VesnaApi({ fetchImpl: async () => new Response('private proxy detail', { status: 502 }) });
    await assert.rejects(api.listItems(), /Request failed \(502\)/);
  });
});
