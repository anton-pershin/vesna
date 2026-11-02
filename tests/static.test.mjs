import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_CACHE, SHELL_RESOURCES } from '../src/offline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('service worker cache contract matches offline readiness resources', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(serviceWorker, new RegExp(`const SHELL_CACHE = '${SHELL_CACHE}';`));
  const resourceList = serviceWorker.match(/const SHELL_RESOURCES = \[([\s\S]*?)\];/);
  assert.ok(resourceList, 'service worker shell resource declaration');
  const workerResources = [...resourceList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(workerResources, SHELL_RESOURCES);
  assert.match(serviceWorker, /caches\.keys\(\)/);
  assert.match(serviceWorker, /vesna-probe-shell-/);
  assert.match(serviceWorker, /caches\.delete\(name\)/);
  for (const resource of SHELL_RESOURCES) {
    const file = resource === '/' ? 'public/index.html' : `public${resource}`;
    assert.ok(fs.existsSync(path.join(root, file)), resource);
  }
  const browserModules = fs.readdirSync(path.join(root, 'public/modules'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => `/modules/${file}`)
    .sort();
  assert.deepEqual(
    SHELL_RESOURCES.filter((resource) => resource.startsWith('/modules/')).sort(),
    browserModules,
  );
});

test('PWA shell declares installable offline resources', () => {
  const manifest = readJson('public/manifest.webmanifest');
  assert.equal(manifest.name, 'Vesna Android playback probe');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  for (const resource of ['public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js']) {
    assert.ok(fs.existsSync(path.join(root, resource)), resource);
  }
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="audio"[^>]*controls/);
  assert.match(html, /id="seekbar"/);
  assert.match(html, /aria-label="Playback position"/);
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.match(app, /\$\('seekbar'\)\.addEventListener\('change'/);
  assert.match(app, /audio\.addEventListener\('timeupdate', updatePosition\)/);
  assert.match(html, /id="play"/);
});

test('fixture metadata, text, and timings share one version and twelve paragraphs', () => {
  const manifest = readJson('public/fixtures/manifest.json');
  const text = readJson('public/fixtures/text.json');
  const timings = readJson('public/fixtures/timings.json');
  assert.equal(manifest.version, text.version);
  assert.equal(manifest.version, timings.version);
  assert.ok(text.paragraphs.length >= 12);
  assert.equal(text.paragraphs.length, timings.paragraphs.length);
  assert.ok(manifest.duration_seconds >= 1800);
  assert.ok(fs.statSync(path.join(root, 'public/fixtures/audio/fixture.mp3')).size > 100000);
});

test('offline evidence procedure exists', () => {
  const evidence = fs.readFileSync(path.join(root, 'evidence/android-playback/README.md'), 'utf8');
  assert.match(evidence, /Huawei Pura 80 Pro/);
  assert.match(evidence, /blocked/);
  assert.ok(fs.existsSync(path.join(root, 'evidence/android-playback/result.md')));
});
