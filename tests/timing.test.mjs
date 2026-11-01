import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveParagraph } from '../src/timing.js';

const timings = [
  { id: 'p1', start: 0, end: 10 },
  { id: 'p2', start: 10, end: 20 },
];

test('resolveParagraph returns the interval containing the playback position', () => {
  assert.equal(resolveParagraph(12, timings), 'p2');
});

test('resolveParagraph chooses the next paragraph at an exact boundary', () => {
  assert.equal(resolveParagraph(10, timings), 'p2');
});

test('resolveParagraph returns no paragraph outside the fixture', () => {
  assert.equal(resolveParagraph(-1, timings), null);
  assert.equal(resolveParagraph(20, timings), null);
});

test('resolveParagraph rejects malformed or overlapping timing data', () => {
  assert.throws(() => resolveParagraph(1, [{ id: 'p1', start: 2, end: 1 }]), /timing/);
  assert.throws(
    () => resolveParagraph(1, [
      { id: 'p1', start: 0, end: 2 },
      { id: 'p2', start: 1, end: 3 },
    ]),
    /timing/,
  );
});
