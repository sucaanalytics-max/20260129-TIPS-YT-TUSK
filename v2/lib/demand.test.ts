/**
 * Unit tests for the pure demand-layer rollup helpers.
 * Run: `npx tsx --test v2/lib/demand.test.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollupAppProxySeries, type AppProxyPoint } from './demand';

/** Daily cumulative-rating series ending at `end`, growing `perDay` per day. */
function dailySeries(days: number, end: string, start: number, perDay: number): AppProxyPoint[] {
  const endMs = new Date(end + 'T00:00:00Z').getTime();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(endMs - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date: d, rating_count: start + i * perDay, rating_avg: 4.5, install_bucket: null };
  });
}

test('rollupAppProxySeries: empty series → null', () => {
  assert.equal(rollupAppProxySeries([]), null);
});

test('rollupAppProxySeries: 30d delta spans exactly 30 days, not the whole series', () => {
  // 180 days of history at +100/day. The delta must be 30 × 100 = 3000,
  // NOT the 179 × 100 = 17900 that anchoring on series[0] would produce.
  const r = rollupAppProxySeries(dailySeries(180, '2026-08-27', 1_000_000, 100), 30)!;
  assert.equal(r.days_observed, 180);
  assert.equal(r.rating_count_delta, 3000);
  assert.equal(r.delta_span_days, 30);
  assert.equal(r.latest.date, '2026-08-27');
});

test('rollupAppProxySeries: series shorter than the window → null delta, not a wrong one', () => {
  // 5 days old. Reporting +400 as a "30d" delta would overstate velocity 6×.
  const r = rollupAppProxySeries(dailySeries(5, '2026-08-27', 1_000_000, 100), 30)!;
  assert.equal(r.rating_count_delta, null);
  assert.equal(r.delta_span_days, null);
  assert.equal(r.days_observed, 5);
});

test('rollupAppProxySeries: exactly 31 rows → anchor is the oldest, span is 30', () => {
  const r = rollupAppProxySeries(dailySeries(31, '2026-08-27', 1_000_000, 100), 30)!;
  assert.equal(r.rating_count_delta, 3000);
  assert.equal(r.delta_span_days, 30);
});

test('rollupAppProxySeries: a gap in the series widens the reported span honestly', () => {
  // Cron missed everything between -45 and -10 days: the newest qualifying
  // anchor is 45 days back, so the span must say 45 — not silently claim 30.
  const series: AppProxyPoint[] = [
    { date: '2026-07-13', rating_count: 1_000_000, rating_avg: 4.5, install_bucket: null }, // -45
    { date: '2026-08-17', rating_count: 1_005_000, rating_avg: 4.5, install_bucket: null }, // -10
    { date: '2026-08-27', rating_count: 1_006_000, rating_avg: 4.5, install_bucket: null }, // -0
  ];
  const r = rollupAppProxySeries(series, 30)!;
  assert.equal(r.rating_count_delta, 6000);
  assert.equal(r.delta_span_days, 45);
});

test('rollupAppProxySeries: unsorted input is sorted; null rating_count → null delta', () => {
  const series: AppProxyPoint[] = [
    { date: '2026-08-27', rating_count: null, rating_avg: null, install_bucket: null },
    { date: '2026-07-01', rating_count: 900_000, rating_avg: 4.4, install_bucket: null },
  ];
  const r = rollupAppProxySeries(series, 30)!;
  assert.equal(r.latest.date, '2026-08-27');
  assert.equal(r.rating_count_delta, null);
  assert.equal(r.history[0].asof, '2026-07-01');
});

test('rollupAppProxySeries: history is ascending and shaped for demandMomentum', () => {
  const r = rollupAppProxySeries(dailySeries(40, '2026-08-27', 500, 10), 30)!;
  assert.equal(r.history.length, 40);
  assert.ok(r.history.every((h, i) => i === 0 || h.asof > r.history[i - 1].asof));
  assert.deepEqual(r.history[r.history.length - 1], { asof: '2026-08-27', metric: 890 });
});
