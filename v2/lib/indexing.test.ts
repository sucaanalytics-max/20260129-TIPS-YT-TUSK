/**
 * Run: npx tsx --test lib/indexing.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexTo100, pairwise } from './indexing';

test('indexTo100: the first usable value becomes 100', () => {
  assert.deepEqual(indexTo100([50, 75, 100]), [100, 150, 200]);
});

test('indexTo100: leading nulls do not become the base', () => {
  // A null start must not index everything off nothing; the base is the first
  // value that actually exists.
  assert.deepEqual(indexTo100([null, 50, 100]), [null, 100, 200]);
});

test('indexTo100: a zero base is skipped rather than dividing by it', () => {
  // A channel with no views on day one would otherwise produce Infinity for
  // every later day.
  assert.deepEqual(indexTo100([0, 50, 100]), [0, 100, 200]);
});

test('indexTo100: a series with nothing usable stays entirely null', () => {
  assert.deepEqual(indexTo100([null, null]), [null, null]);
  assert.deepEqual(indexTo100([0, 0]), [null, null]);
});

test('indexTo100: interior nulls are preserved, not interpolated', () => {
  // A missing day is unknown. Filling it would invent a measurement.
  assert.deepEqual(indexTo100([50, null, 100]), [100, null, 200]);
});

test('pairwise: keeps only indices where both series have a value', () => {
  const got = pairwise([1, null, 3, 4], [10, 20, null, 40]);
  assert.deepEqual(got, { x: [1, 4], y: [10, 40] });
});

test('pairwise: non-finite values are dropped like nulls', () => {
  const got = pairwise([1, Number.NaN, 3], [10, 20, Number.POSITIVE_INFINITY]);
  assert.deepEqual(got, { x: [1], y: [10] });
});

test('pairwise: ragged lengths do not read past the shorter series', () => {
  const got = pairwise([1, 2, 3], [10]);
  assert.deepEqual(got, { x: [1], y: [10] });
});
