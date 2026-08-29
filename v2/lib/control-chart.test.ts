/**
 * Tests for the control-chart primitives behind /analysis.
 * Run: `npx tsx --test v2/lib/control-chart.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movingAverage, controlLimits, buildControlChart } from './control-chart';

const seq = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

test('movingAverage: warms up, then trails the window', () => {
  const ma = movingAverage([1, 2, 3, 4, 5], 3);
  assert.deepEqual(ma, [null, null, 2, 3, 4]);
});

test('movingAverage: window of 1 is the identity', () => {
  assert.deepEqual(movingAverage([5, 7], 1), [5, 7]);
});

test('movingAverage: nulls do not poison the window — they shorten it', () => {
  // A frozen upstream day is unknown, not zero. Averaging it as 0 would drag
  // the mean down and invent a dip that never happened.
  assert.deepEqual(movingAverage([3, null, 5], 3), [null, null, 4]);
});

test('movingAverage: a window with no observations at all yields null', () => {
  assert.deepEqual(movingAverage([null, null, null], 2), [null, null, null]);
});

test('controlLimits: mean, sigma and the four limits', () => {
  const l = controlLimits([2, 4, 4, 4, 5, 5, 7, 9])!;
  assert.equal(l.mean, 5);
  assert.equal(Math.round(l.sd * 1000) / 1000, 2.138); // sample sd, n-1
  assert.equal(Math.round(l.ucl1 * 1000) / 1000, 7.138);
  assert.equal(Math.round(l.lcl1 * 1000) / 1000, 2.862);
  assert.equal(Math.round(l.ucl2 * 1000) / 1000, 9.276);
  assert.equal(Math.round(l.lcl2 * 1000) / 1000, 0.724);
  assert.equal(l.n, 8);
});

test('controlLimits: needs at least two observations', () => {
  assert.equal(controlLimits([]), null);
  assert.equal(controlLimits([5]), null);
  assert.equal(controlLimits([null, 5]), null);
});

test('buildControlChart: flags points beyond ±2σ, and only those', () => {
  const pts = seq(30, (i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, value: 100 }));
  pts[10].value = 400; // a genuine excursion
  const c = buildControlChart(pts, [15]);
  assert.equal(c.violations.length, 1);
  assert.equal(c.violations[0].date, '2026-01-11');
  assert.ok(c.violations[0].sigma > 2);
});

test('buildControlChart: an in-control process reports no violations', () => {
  const pts = seq(40, (i) => ({ date: `d${i}`, value: 100 + (i % 4) - 1.5 }));
  assert.equal(buildControlChart(pts, [15]).violations.length, 0);
});

test('buildControlChart: one-sided breaches are reported as skewed', () => {
  // 12 above and 0 below is what TIPSMUSIC subscriber adds actually do — a
  // symmetric process splits them, so Shewhart limits do not strictly apply.
  // Spikes are kept rare on purpose: at ~20% frequency they inflate σ enough to
  // mask themselves (+2σ lands above the spike), which is its own trap.
  const pts = seq(60, (i) => ({ date: `d${i}`, value: i % 15 === 0 ? 900 : 10 }));
  const c = buildControlChart(pts, [15]);
  assert.ok(c.skew.above > 0);
  assert.equal(c.skew.below, 0);
  assert.equal(c.skew.oneSided, true);
});

test('buildControlChart: balanced breaches are not flagged as skewed', () => {
  const pts = seq(60, (i) => ({ date: `d${i}`, value: 100 }));
  pts[5].value = 400; pts[6].value = -200;
  const c = buildControlChart(pts, [15]);
  assert.equal(c.skew.oneSided, false);
});

test('buildControlChart: returns a moving average per requested window', () => {
  const pts = seq(20, (i) => ({ date: `d${i}`, value: i }));
  const c = buildControlChart(pts, [5, 10]);
  assert.deepEqual(Object.keys(c.movingAverages).map(Number), [5, 10]);
  assert.equal(c.movingAverages[5].length, 20);
  assert.equal(c.movingAverages[5][4], 2);
});

test('buildControlChart: empty input degrades to null limits, no throw', () => {
  const c = buildControlChart([], [15]);
  assert.equal(c.limits, null);
  assert.deepEqual(c.violations, []);
});
