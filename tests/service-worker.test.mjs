import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const serviceWorkerSource = readFileSync(new URL('../probe/sw.js', import.meta.url), 'utf8');
const fixtureText = '0123456789abcdef';
const fixtureBytes = new TextEncoder().encode(fixtureText);

function fixtureResponse() {
  return new Response(fixtureBytes, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(fixtureBytes.byteLength),
      'X-Fixture': 'preserved',
    },
  });
}

function createFetchHandler(cached) {
  const listeners = new Map();
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const caches = {
    async open(name) {
      return {
        async match() {
          return name === 'vesna-probe-shell-v13' ? cached : undefined;
        },
      };
    },
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: async () => {
      throw new Error('network fallback should not be used for a cached request');
    },
    Headers,
    Response,
    URL,
  });
  new vm.Script(serviceWorkerSource, { filename: 'probe/sw.js' }).runInContext(context);

  return async (request) => {
    let pendingResponse;
    listeners.get('fetch')({
      request,
      respondWith(response) {
        pendingResponse = Promise.resolve(response);
      },
    });
    assert.ok(pendingResponse, 'fetch listener calls respondWith');
    return pendingResponse;
  };
}

function rangeRequest(range) {
  return new Request('https://example.test/fixtures/audio/fixture.mp3', {
    headers: { Range: range },
  });
}

test('serves an explicit single range from a complete cached response', async () => {
  const response = await createFetchHandler(fixtureResponse())(rangeRequest('bytes=2-5'));

  assert.equal(response.status, 206);
  assert.equal(await response.text(), '2345');
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(response.headers.get('X-Fixture'), 'preserved');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/16');
  assert.equal(response.headers.get('Content-Length'), '4');
});

test('serves open-ended and suffix ranges and clamps the end', async (t) => {
  const cases = [
    { range: 'bytes=12-', body: 'cdef', contentRange: 'bytes 12-15/16', length: '4' },
    { range: 'bytes=-5', body: 'bcdef', contentRange: 'bytes 11-15/16', length: '5' },
    { range: 'bytes=14-99', body: 'ef', contentRange: 'bytes 14-15/16', length: '2' },
  ];

  for (const { range, body, contentRange, length } of cases) {
    await t.test(range, async () => {
      const response = await createFetchHandler(fixtureResponse())(rangeRequest(range));
      assert.equal(response.status, 206);
      assert.equal(await response.text(), body);
      assert.equal(response.headers.get('Content-Range'), contentRange);
      assert.equal(response.headers.get('Content-Length'), length);
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    });
  }
});

test('returns 416 only for valid ranges with no satisfiable part', async (t) => {
  const ranges = [
    'bytes=16-',
    'bytes=-0',
    'bytes=16-,17-',
  ];

  for (const range of ranges) {
    await t.test(range, async () => {
      const response = await createFetchHandler(fixtureResponse())(rangeRequest(range));
      assert.equal(response.status, 416);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('Content-Range'), 'bytes */16');
      assert.equal(response.headers.get('Content-Length'), '0');
      assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
      assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
    });
  }
});

test('ignores malformed, unsupported, and unhandled multiple ranges', async (t) => {
  const ranges = [
    'bytes=0-1,4-5',
    'items=0-1',
    'bytes=invalid',
    'bytes=7-6',
    'bytes=99-1',
    'bytes=0-1,',
  ];

  for (const range of ranges) {
    await t.test(range, async () => {
      const response = await createFetchHandler(fixtureResponse())(rangeRequest(range));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Content-Range'), null);
      assert.equal(await response.text(), fixtureText);
    });
  }
});

test('returns an ordinary cached response unchanged', async () => {
  const cached = fixtureResponse();
  const response = await createFetchHandler(cached)(new Request('https://example.test/fixtures/audio/fixture.mp3'));

  assert.equal(response, cached);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), fixtureText);
  assert.equal(response.headers.get('Content-Length'), '16');
});
