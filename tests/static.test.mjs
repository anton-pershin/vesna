import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_CACHE, SHELL_RESOURCES } from '../public/modules/offline.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('service worker cache contract matches offline readiness resources', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(serviceWorker, new RegExp(`const SHELL_CACHE = '${SHELL_CACHE}';`));
  const resourceList = serviceWorker.match(/const SHELL_RESOURCES = \[([\s\S]*?)\];/);
  assert.ok(resourceList, 'service worker shell resource declaration');
  const workerResources = [...resourceList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(workerResources, SHELL_RESOURCES);
  assert.ok(!SHELL_RESOURCES.includes('/'), 'root uses the cached index fallback, not a cache key');
  assert.ok(SHELL_RESOURCES.includes('/index.html'));
  assert.match(serviceWorker, /caches\.keys\(\)/);
  assert.match(serviceWorker, /vesna-probe-shell-/);
  assert.match(serviceWorker, /caches\.delete\(name\)/);
  assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
  assert.match(serviceWorker, /new URL\('\/index\.html', self\.location\.origin\)/);
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
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((candidate) => (
      candidate.type === 'image/png' && candidate.sizes === `${size}x${size}` && candidate.purpose === 'any'
    ));
    assert.ok(icon, `manifest has a ${size}px PNG icon`);
    const bytes = fs.readFileSync(path.join(root, `public${icon.src}`));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some((icon) => (
    icon.src === '/icon-maskable-512.png' && icon.type === 'image/png' && icon.purpose === 'maskable'
  )));
  for (const resource of ['public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js']) {
    assert.ok(fs.existsSync(path.join(root, resource)), resource);
  }
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="audio"[^>]*controls/);
  assert.match(html, /id="seekbar"/);
  assert.match(html, /aria-label="Playback position"/);
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.match(app, /new SeekBarController\(\$\('seekbar'\), audio, seekbarPlayer/);
  assert.match(app, /audio\.addEventListener\('timeupdate', updatePosition\)/);
  assert.match(app, /restoreGuard\.completeNativeSeek\(target, audio\.currentTime\)/);
  assert.match(app, /window\.addEventListener\('pagehide', saveState\)/);
  assert.doesNotMatch(app, /audio\.addEventListener\('pagehide', saveState\)/);
  assert.match(app, /actual audio position \$\{Math\.floor\(restoredPosition\)\}/);
  assert.match(app, /restoreGuard\.blocked \|\| !player/);
  assert.match(app, /await restoreGuard\.replace\(operation\)/);
  assert.match(app, /seekBy: \(offset\) => replacePlaybackPosition/);
  assert.match(app, /fetchImpl: fetchFixtureFromNetwork/);
  assert.match(app, /await restoreOfflineFixturePointer/);
  assert.match(app, /downloadVersion !== version/);
  assert.match(app, /\$\('build'\)/);
  assert.match(html, /id="build"/);
  assert.match(app, /seekbarController/);
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
  const audio = fs.readFileSync(path.join(root, 'public/fixtures/audio/fixture.mp3'));
  assert.equal(audio.byteLength, manifest.audio_bytes);
  assert.equal(createHash('sha256').update(audio).digest('hex'), manifest.audio_sha256);
});

test('offline evidence procedure exists', () => {
  const evidence = fs.readFileSync(path.join(root, 'evidence/android-playback/README.md'), 'utf8');
  assert.match(evidence, /Huawei Pura 80 Pro/);
  assert.match(evidence, /blocked/);
  assert.ok(fs.existsSync(path.join(root, 'evidence/android-playback/result.md')));
});
