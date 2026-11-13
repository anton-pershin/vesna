import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = (relative) => JSON.parse(read(relative));

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('production PWA is installable and contains no synthetic probe composition', () => {
  const manifest = readJson('public/manifest.webmanifest');
  assert.equal(manifest.name, 'Vesna listening application');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((candidate) => candidate.sizes === `${size}x${size}` && candidate.purpose === 'any');
    const bytes = fs.readFileSync(path.join(root, `public${icon.src}`));
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  const iconHashes = {
    'public/icon-192.png': 'fb529f99a9849401530dd10aa2004f6893f51f23125be896ba7f564c782b7641',
    'public/icon-512.png': '60807056748a14a833a5024c6d4ef73b79fd081b3af4c1281b7bbfc0ebc3453a',
    'public/icon-maskable-512.png': '071e876ea2f07a2748de3c992ad3eb868d84a44d72e549d87196b0a7cfc5bbe4',
  };
  for (const [file, expected] of Object.entries(iconHashes)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), expected, `${file} preserves the approved A1 artwork`);
  }

  const browserFiles = [
    'public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js',
    ...fs.readdirSync(path.join(root, 'public/modules')).map((name) => `public/modules/${name}`),
  ];
  for (const file of browserFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /fixtures\/|runFixtureDownload|OfflineFixture|playback probe|PROBE_BUILD/, file);
  }
  assert.equal(fs.existsSync(path.join(root, 'public/fixtures/manifest.json')), false);
  assert.ok(fs.existsSync(path.join(root, 'probe/fixtures/manifest.json')));
});

test('production shell keeps private content inert and exposes labelled mobile controls', () => {
  const html = read('public/index.html');
  for (const id of ['password', 'build-version', 'article-url', 'markdown-file', 'library', 'library-view', 'input-view', 'item-view', 'audio', 'seekbar', 'play-pause', 'previous', 'next', 'speed', 'autoscroll', 'source-download', 'article-link', 'delete-dialog', 'delete-item', 'confirm-delete']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<label for="password">Password<\/label>/);
  assert.match(html, /<label for="article-url">/);
  assert.match(html, /<label class="file-picker" for="markdown-file">/);
  assert.match(html, /accept="\.md,\.markdown/);
  assert.match(html, /up to 1 MiB/);
  assert.match(html, /aria-label="Read-along playback controls"/);
  assert.match(html, /id="position"[^>]*aria-live="off"/);
  assert.match(html, /<audio id="audio" preload="metadata" aria-hidden="true"><\/audio>/);
  assert.match(html, /aria-labelledby="delete-heading" aria-describedby="delete-description"/);
  assert.match(html, /Use the password configured for this Vesna installation/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /role="status" aria-live="polite"/);

  const app = read('public/app.js');
  const views = read('public/modules/views.js');
  assert.doesNotMatch(app + views, /\.innerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.match(views, /\.textContent/);
  assert.match(views, /Current paragraph/);
  assert.match(views, /aria-current/);
  assert.match(app, /api\.build\(\)/);
  assert.match(app, /\$\('empty-add'\)\.addEventListener\('click', showInput\)/);
  assert.match(app, /loadedSourceItem = null/);
  assert.match(app, /restoreGuard\.blocked/);
  assert.match(app, /restoreGuard\.fail\(saved\)/);
  assert.match(app, /stateStore\.load\(item\.id, item\.version\)/);
  assert.match(app, /itemId: current\.item\.id/);
  assert.match(app, /version: current\.version/);

  const css = read('public/styles.css');
  assert.match(css, /\* \{ box-sizing: border-box; \}/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.reader li\.current/);
  assert.match(css, /\.current-marker/);
  assert.match(css, /#seekbar \{[^}]*min-height: 44px/);
  assert.match(css, /max-width: 100%/);
});

test('text and control colors meet mobile accessibility contrast thresholds', () => {
  for (const [foreground, background] of [
    ['#26332d', '#f7f3eb'],
    ['#656c64', '#f7f3eb'],
    ['#1d5b47', '#e4eee5'],
    ['#7b5825', '#f0eadb'],
    ['#984e41', '#f4e6df'],
    ['#ffffff', '#276f58'],
  ]) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
  for (const [foreground, background] of [
    ['#7d847b', '#fffdf8'],
    ['#276f58', '#f7f3eb'],
    ['#276f58', '#e4eee5'],
    ['#984e41', '#f4e6df'],
  ]) {
    assert.ok(contrast(foreground, background) >= 3, `${foreground} on ${background}`);
  }
});

test('production service-worker shell list contains exactly the canonical public modules', () => {
  const worker = read('public/sw.js');
  const declaration = worker.match(/const SHELL_RESOURCES = \[([\s\S]*?)\];/);
  assert.ok(declaration);
  const resources = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const modules = fs.readdirSync(path.join(root, 'public/modules'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `/modules/${name}`);
  assert.deepEqual(resources.filter((resource) => resource.startsWith('/modules/')).sort(), modules.sort());
  for (const resource of resources) {
    assert.ok(fs.existsSync(path.join(root, `public${resource}`)), resource);
    assert.ok(!resource.startsWith('/api/'));
    assert.ok(!resource.startsWith('/fixtures/'));
    assert.ok(!resource.startsWith('/probe'));
  }
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(worker, /cache\.add\(/);
  assert.match(worker, /networkFirstShell/);
  assert.match(worker, /new URL\(resource, self\.location\.origin\)/);
  assert.match(worker, /cache: 'reload'/);
});
