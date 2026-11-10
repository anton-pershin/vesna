import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePreparedVersion } from '../public/modules/prepared.js';

const text = (version = 'version-1') => ({
  version,
  paragraphs: [
    { id: 'p0', text: 'First' },
    { id: 'p1', text: 'Second' },
  ],
});
const timings = (version = 'version-1') => ({
  version,
  timings: [
    { id: 'p0', start: 0, end: 1.25 },
    { id: 'p1', start: 1.25, end: 3.5 },
  ],
});

test('prepared playback accepts only matching text and timing versions', () => {
  const result = validatePreparedVersion(text(), timings(), 'version-1');
  assert.equal(result.duration, 3.5);
  assert.deepEqual(result.paragraphs.map((paragraph) => paragraph.id), ['p0', 'p1']);
  assert.throws(() => validatePreparedVersion(text('version-2'), timings(), 'version-1'), /same complete version/);
  assert.throws(() => validatePreparedVersion(text(), timings('version-2'), 'version-1'), /same complete version/);
});

test('prepared playback rejects missing, duplicated, or mismatched paragraph data', () => {
  const duplicate = text();
  duplicate.paragraphs[1].id = 'p0';
  assert.throws(() => validatePreparedVersion(duplicate, timings(), 'version-1'), /inconsistent/);

  const mismatch = timings();
  mismatch.timings[1].id = 'other';
  assert.throws(() => validatePreparedVersion(text(), mismatch, 'version-1'), /inconsistent/);

  const missing = text();
  missing.paragraphs.pop();
  assert.throws(() => validatePreparedVersion(missing, timings(), 'version-1'), /same complete version/);

  assert.throws(() => validatePreparedVersion({ version: 'version-1', paragraphs: [] }, {
    version: 'version-1', timings: [],
  }, 'version-1'), /same complete version/);
});

test('prepared playback rejects non-finite, overlapping, and zero-length timings', () => {
  for (const mutate of [
    (value) => { value.timings[0].start = Number.NaN; },
    (value) => { value.timings[0].end = 0; },
    (value) => { value.timings[1].start = 1; },
    (value) => { value.timings[1].end = Number.POSITIVE_INFINITY; },
  ]) {
    const value = timings();
    mutate(value);
    assert.throws(() => validatePreparedVersion(text(), value, 'version-1'), /inconsistent/);
  }
});
