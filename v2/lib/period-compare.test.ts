/**
 * Tests for quarter/year bucketing and regime-aware comparison.
 * Run: `npx tsx --test v2/lib/period-compare.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKey, bucketByPeriod, comparePeriods, REGIME_BREAK } from './period-compare';

test('periodKey: quarters and years', () => {
  assert.equal(periodKey('2026-08-27', 'quarter'), '2026-Q3');
  assert.equal(periodKey('2026-01-01', 'quarter'), '2026-Q1');
  assert.equal(periodKey('2025-12-31', 'quarter'), '2025-Q4');
  assert.equal(periodKey('2026-08-27', 'year'), '2026');
});

test('bucketByPeriod: sums values and counts days', () => {
  const rows = [
    { date: '2026-01-05', value: 10 },
    { date: '2026-02-20', value: 20 },
    { date: '2026-04-01', value: 5 },
  ];
  const b = bucketByPeriod(rows, 'quarter');
  assert.equal(b.length, 2);
  assert.deepEqual(
    b.map((x) => [x.key, x.total, x.days]),
    [['2026-Q1', 30, 2], ['2026-Q2', 5, 1]],
  );
});

test('bucketByPeriod: nulls are skipped, not counted as zero', () => {
  const b = bucketByPeriod(
    [{ date: '2026-01-05', value: 10 }, { date: '2026-01-06', value: null }],
    'quarter',
  );
  assert.equal(b[0].total, 10);
  assert.equal(b[0].days, 1);
  assert.equal(b[0].missing, 1);
});

test('bucketByPeriod: flags periods that straddle the measurement regime break', () => {
  // Before 2026-02-16 the company series is a single legacy aggregate row/day;
  // after it, real per-channel data. A bucket spanning the boundary mixes both.
  const rows = [
    { date: '2026-01-10', value: 1 }, // legacy
    { date: '2026-03-10', value: 1 }, // per-channel
  ];
  const b = bucketByPeriod(rows, 'quarter');
  assert.equal(b.find((x) => x.key === '2026-Q1')!.straddlesRegimeBreak, true);
  assert.equal(b.find((x) => x.key === '2026-Q2'), undefined);
});

test('bucketByPeriod: a wholly-legacy period is marked legacy, not straddling', () => {
  const b = bucketByPeriod([{ date: '2025-05-01', value: 1 }], 'quarter');
  assert.equal(b[0].regime, 'legacy');
  assert.equal(b[0].straddlesRegimeBreak, false);
});

test('bucketByPeriod: a wholly-current period is marked current', () => {
  const b = bucketByPeriod([{ date: '2026-07-01', value: 1 }], 'quarter');
  assert.equal(b[0].regime, 'current');
});

test('comparePeriods: percentage change against the prior period', () => {
  const rows = [
    { date: '2026-04-01', value: 100 },
    { date: '2026-07-01', value: 150 },
  ];
  const c = comparePeriods(rows, 'quarter');
  const latest = c[c.length - 1];
  assert.equal(latest.key, '2026-Q3');
  assert.equal(latest.total, 150);
  assert.equal(latest.priorTotal, 100);
  assert.equal(latest.changePct, 50);
});

test('comparePeriods: the first period has no prior', () => {
  const c = comparePeriods([{ date: '2026-04-01', value: 100 }], 'quarter');
  assert.equal(c[0].priorTotal, null);
  assert.equal(c[0].changePct, null);
});

test('comparePeriods: a comparison across the regime break is marked not-like-for-like', () => {
  const rows = [
    { date: '2025-10-05', value: 100 }, // legacy quarter
    { date: '2026-07-05', value: 150 }, // current quarter
  ];
  const c = comparePeriods(rows, 'quarter');
  const latest = c[c.length - 1];
  assert.equal(latest.comparable, false);
  assert.ok(latest.caveat && latest.caveat.length > 0);
});

test('comparePeriods: same-regime comparison is like-for-like', () => {
  const rows = [
    { date: '2026-04-05', value: 100 },
    { date: '2026-07-05', value: 150 },
  ];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.comparable, true);
  assert.equal(latest.caveat, null);
});

test('comparePeriods: division by zero yields null, not Infinity', () => {
  const rows = [
    { date: '2026-04-01', value: 0 },
    { date: '2026-07-01', value: 5 },
  ];
  assert.equal(comparePeriods(rows, 'quarter').at(-1)!.changePct, null);
});

test('REGIME_BREAK is the first per-channel day', () => {
  assert.equal(REGIME_BREAK, '2026-02-16');
});
