import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(t) {
  const child = spawn('python3', [
    'scripts/static_server.py',
    '--directory', 'public',
    '--bind', '127.0.0.1',
    '--port', '0',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });

  const port = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error(`static server did not start: ${errors}`)), 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/:(\d+)\s/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`static server exited with ${code}: ${errors}`));
    });
  });
  return { child, origin: `http://127.0.0.1:${port}` };
}

test('static server returns exact audio ranges over HTTP', async (t) => {
  const { origin } = await startServer(t);
  const audioUrl = `${origin}/fixtures/audio/fixture.mp3`;
  const fixture = await readFile(path.join(root, 'public/fixtures/audio/fixture.mp3'));

  const response = await fetch(audioUrl, { headers: { Range: 'bytes=1000-1999' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Range'), `bytes 1000-1999/${fixture.byteLength}`);
  assert.equal(response.headers.get('Content-Length'), '1000');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.subarray(1000, 2000));

  const ordinary = await fetch(audioUrl);
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.headers.get('Accept-Ranges'), 'bytes');
  await ordinary.arrayBuffer();

  const unsatisfiable = await fetch(audioUrl, { headers: { Range: `bytes=${fixture.byteLength}-` } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get('Content-Range'), `bytes */${fixture.byteLength}`);

  for (const range of ['bytes=invalid', 'items=0-1', 'bytes=0-1,4-5']) {
    const ignored = await fetch(audioUrl, { method: 'HEAD', headers: { Range: range } });
    assert.equal(ignored.status, 200, range);
    assert.equal(ignored.headers.get('Content-Range'), null, range);
    assert.equal(ignored.headers.get('Content-Length'), String(fixture.byteLength), range);
  }

  const multipleUnsatisfiable = await fetch(audioUrl, {
    headers: { Range: `bytes=${fixture.byteLength}-,${fixture.byteLength + 1}-` },
  });
  assert.equal(multipleUnsatisfiable.status, 416);
});
