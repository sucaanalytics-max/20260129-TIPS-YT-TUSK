import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNowcast, DEFAULT_ASSUMPTIONS, type NowcastDrivers } from './nowcast';

const drivers: NowcastDrivers = {
  ownedViews: 1_000_000_000,
  topicViews: 400_000_000,
  ugcViews: 30_000_000,
};
const flat = { cpmLow: 100, cpmMid: 120, cpmHigh: 140, nonYouTubeUplift: 1, includeUgc: true };

test('computeNowcast: extrapolates quarter-to-date views to a full quarter', () => {
  const half = computeNowcast({ drivers, assumptions: flat, quarterProgress: 0.5 });
  const full = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  assert.equal(half.projectedViews, full.projectedViews * 2);
});

test('computeNowcast: band is CPM applied per 1,000 projected views', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  // 1.43bn views projected; at Rs120/1k that is Rs 171,600,000
  assert.equal(r.projectedViews, 1_430_000_000);
  assert.equal(r.band.mid, 171_600_000);
  assert.equal(r.band.low, 143_000_000);
  assert.equal(r.band.high, 200_200_000);
});

test('computeNowcast: excluding UGC removes it from the projection', () => {
  const withUgc = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  const without = computeNowcast({
    drivers, assumptions: { ...flat, includeUgc: false }, quarterProgress: 1,
  });
  assert.equal(withUgc.projectedViews - without.projectedViews, drivers.ugcViews);
});

test('computeNowcast: non-YouTube uplift scales the whole band', () => {
  const base = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  const up = computeNowcast({
    drivers, assumptions: { ...flat, nonYouTubeUplift: 1.5 }, quarterProgress: 1,
  });
  assert.equal(up.band.mid, base.band.mid * 1.5);
});

test('computeNowcast: contributions name each driver and sum to 100%', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  assert.deepEqual(r.contributions.map((c) => c.driver), ['owned', 'topic', 'ugc']);
  const total = r.contributions.reduce((a, c) => a + c.pctOfMid, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.ok(r.contributions[0].pctOfMid > r.contributions[1].pctOfMid);
});

test('computeNowcast: zero progress yields no projection rather than Infinity', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 0 });
  assert.equal(r.projectedViews, 0);
  assert.equal(r.band.mid, 0);
});

test('computeNowcast: band is ordered low <= mid <= high', () => {
  const r = computeNowcast({ drivers, assumptions: DEFAULT_ASSUMPTIONS, quarterProgress: 0.65 });
  assert.ok(r.band.low <= r.band.mid && r.band.mid <= r.band.high);
});
