import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('PWA shell declares installable offline resources', () => {
  const manifest = readJson('public/manifest.webmanifest');
  assert.equal(manifest.name, 'Vesna Android playback probe');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  for (const resource of ['public/index.html', 'public/app.js', 'public/styles.css', 'public/sw.js']) {
    assert.ok(fs.existsSync(path.join(root, resource)), resource);
  }
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
