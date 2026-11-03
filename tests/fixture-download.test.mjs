import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureDownload } from '../public/modules/fixture-download.js';

test('version-changing download pauses before publication and reloads without a readiness wait', async () => {
  const events = [];
  const published = { version: 'v2' };
  const result = await runFixtureDownload({
    currentVersion: 'v1',
    downloadVersion: 'v2',
    pause: () => events.push('pause'),
    replace: async () => { events.push('replace'); return published; },
    reload: () => events.push('reload'),
    verify: async () => { throw new Error('readiness must not run before reload'); },
  });

  assert.deepEqual(events, ['pause', 'replace', 'reload']);
  assert.deepEqual(result, { published, reloaded: true });
});

test('same-version download verifies readiness without pausing or reloading', async () => {
  const events = [];
  const published = { version: 'v1', cacheName: 'fixture-v1' };
  const result = await runFixtureDownload({
    currentVersion: 'v1',
    downloadVersion: 'v1',
    pause: () => events.push('pause'),
    replace: async () => { events.push('replace'); return published; },
    reload: () => events.push('reload'),
    verify: async (record) => { events.push(['verify', record.cacheName]); },
  });

  assert.deepEqual(events, ['replace', ['verify', 'fixture-v1']]);
  assert.deepEqual(result, { published, reloaded: false });
});

test('failed version-changing replacement stays paused and does not reload or verify', async () => {
  const events = [];
  await assert.rejects(runFixtureDownload({
    currentVersion: 'v1',
    downloadVersion: 'v2',
    pause: () => events.push('pause'),
    replace: async () => { events.push('replace'); throw new Error('download failed'); },
    reload: () => events.push('reload'),
    verify: async () => events.push('verify'),
  }), /download failed/);

  assert.deepEqual(events, ['pause', 'replace']);
});
