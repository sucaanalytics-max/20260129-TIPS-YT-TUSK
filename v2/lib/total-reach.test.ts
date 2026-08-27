/**
 * Unit tests for the total-reach pure helpers (weekly bucketing + band).
 *
 * Run with: `npm test` (Node's built-in node:test via tsx, zero install).
 * These are pure functions — no DB, no IO.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekStartMonday,
  bucketWeekly,
  trimPartialEdges,
  buildReachBand,
  K_TOPIC_LOW,
  K_TOPIC_HIGH,
} from './total-reach';

// --- weekStartMonday ---------------------------------------------------------
// 2026 anchor: 2026-05-31 is a Sunday (UGC cron runs Sundays), so
// 2026-05-25 / 2026-05-18 / 2026-06-01 are Mondays.

test('weekStartMonday: Thursday maps back to its Monday', () => {
  assert.equal(weekStartMonday('2026-05-21'), '2026-05-18');
});

test('weekStartMonday: a Monday maps to itself', () => {
  assert.equal(weekStartMonday('2026-05-25'), '2026-05-25');
});

test('weekStartMonday: Sunday maps back to the same week Monday', () => {
  // 2026-05-31 (Sun) belongs to the week starting Mon 2026-05-25
  assert.equal(weekStartMonday('2026-05-31'), '2026-05-25');
});

test('weekStartMonday: Friday maps back to its Monday', () => {
  assert.equal(weekStartMonday('2026-06-05'), '2026-06-01');
});

// --- bucketWeekly ------------------------------------------------------------

test('bucketWeekly: sums non-null values per Monday-week and counts days with data', () => {
  const out = bucketWeekly([
    { date: '2026-05-18', value: 10 }, // wk 05-18 (Mon)
    { date: '2026-05-20', value: 20 }, // wk 05-18 (Wed)
    { date: '2026-05-24', value: 7 }, // wk 05-18 (Sun)
    { date: '2026-05-25', value: 5 }, // wk 05-25 (Mon)
    { date: '2026-05-26', value: null }, // wk 05-25 — null ignored
  ]);
  assert.deepEqual(out, [
    { weekStart: '2026-05-18', sum: 37, days: 3 },
    { weekStart: '2026-05-25', sum: 5, days: 1 },
  ]);
});

test('bucketWeekly: empty input → empty output', () => {
  assert.deepEqual(bucketWeekly([]), []);
});

// --- trimPartialEdges --------------------------------------------------------

test('trimPartialEdges: drops leading/trailing weeks with <7 days, keeps interior gaps', () => {
  const buckets = [
    { weekStart: 'w1', sum: 1, days: 3 },
    { weekStart: 'w2', sum: 2, days: 7 },
    { weekStart: 'w3', sum: 3, days: 5 }, // interior gap — KEPT
    { weekStart: 'w4', sum: 4, days: 7 },
    { weekStart: 'w5', sum: 5, days: 2 },
  ];
  assert.deepEqual(
    trimPartialEdges(buckets).map((b) => b.weekStart),
    ['w2', 'w3', 'w4'],
  );
});

test('trimPartialEdges: all-full weeks are unchanged', () => {
  const buckets = [
    { weekStart: 'w1', sum: 1, days: 7 },
    { weekStart: 'w2', sum: 2, days: 7 },
  ];
  assert.deepEqual(trimPartialEdges(buckets), buckets);
});

// --- buildReachBand ----------------------------------------------------------

test('buildReachBand: owned is the certain core; topic carries the band width', () => {
  const b = buildReachBand({ owned: 1000, topic: 100 });
  assert.equal(b.mid, 1100);
  assert.equal(b.low, Math.round(1000 + 100 * K_TOPIC_LOW));
  assert.equal(b.high, Math.round(1000 + 100 * K_TOPIC_HIGH));
  // ordering
  assert.ok(b.low <= b.mid && b.mid <= b.high);
});

test('buildReachBand: zero topic → degenerate band equal to owned', () => {
  const b = buildReachBand({ owned: 500, topic: 0 });
  assert.deepEqual(b, { low: 500, mid: 500, high: 500 });
});

test('buildReachBand: band constants are conservative (kLow ≤ 1 ≤ kHigh)', () => {
  assert.ok(K_TOPIC_LOW <= 1 && K_TOPIC_HIGH >= 1);
});
