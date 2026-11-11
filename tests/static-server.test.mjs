import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import net from 'node:net';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startServer(t, extraArgs = []) {
  const child = spawn('python3', [
    'probe/static_server.py',
    '--directory', 'probe',
    '--shared-modules', 'public/modules',
    '--bind', '127.0.0.1',
    '--port', '0',
    ...extraArgs,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await once(child, 'exit');
  });

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
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`static server exited with ${code}: ${errors}`));
    });
  });
  const scheme = extraArgs.includes('--certificate') ? 'https' : 'http';
  return { child, origin: `${scheme}://127.0.0.1:${port}` };
}

test('static server returns exact audio ranges over HTTP', async (t) => {
  const { origin } = await startServer(t);
  const audioUrl = `${origin}/fixtures/audio/fixture.mp3`;
  const fixture = await readFile(path.join(root, 'probe/fixtures/audio/fixture.mp3'));

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

  for (const range of ['bytes=invalid', 'bytes=7-6', 'items=0-1', 'bytes=0-1,4-5']) {
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

test('isolated probe serves its own assets and aliases canonical shared modules', async (t) => {
  const { origin } = await startServer(t);
  const index = await fetch(`${origin}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Vesna playback probe/);

  const app = await fetch(`${origin}/app.js`);
  assert.equal(app.headers.get('Cache-Control'), 'no-cache');
  assert.match(await app.text(), /\/probe-modules\/offline\.js/);
  const worker = await fetch(`${origin}/sw.js`);
  assert.equal(worker.headers.get('Cache-Control'), 'no-cache');
  assert.equal(worker.status, 200);
  const shared = await fetch(`${origin}/modules/player.js`);
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /export class PlaybackController/);
  const probeModule = await fetch(`${origin}/probe-modules/offline.js`);
  assert.equal(probeModule.status, 200);
  assert.match(await probeModule.text(), /replaceOfflineFixture/);
  const productionOnly = await fetch(`${origin}/fixtures/manifest.json`);
  assert.equal(productionOnly.status, 200, 'the fixture exists only in the isolated probe root');
  assert.match(await productionOnly.text(), /fixture-en-v1/);
});

test('a stalled TLS handshake does not block other HTTPS clients', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vesna-tls-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certificate = path.join(directory, 'certificate.pem');
  const key = path.join(directory, 'key.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', key, '-out', certificate,
  ], { stdio: 'ignore' });
  const { origin } = await startServer(t, ['--certificate', certificate, '--key', key]);
  const { port } = new URL(origin);
  const stalled = net.connect(Number(port), '127.0.0.1');
  t.after(() => { stalled.destroy(); });
  await once(stalled, 'connect');

  const agent = new https.Agent({ rejectUnauthorized: false });
  t.after(() => { agent.destroy(); });
  const response = await new Promise((resolve, reject) => {
    const request = https.get(`${origin}/fixtures/manifest.json`, { agent }, resolve);
    request.setTimeout(5000, () => request.destroy(new Error('HTTPS request timed out')));
    request.once('error', reject);
  });
  assert.equal(response.statusCode, 200);
  const ended = once(response, 'end');
  response.resume();
  await ended;
});
