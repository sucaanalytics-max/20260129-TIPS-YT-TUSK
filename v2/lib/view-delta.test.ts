/**
 * Tests for cumulative-view delta computation and frozen-plateau repair.
 * Run: `npx tsx --test v2/lib/view-delta.test.ts`
 *
 * Context: YouTube's Data API intermittently serves a STALE cumulative
 * viewCount — the same number for consecutive days across every channel — then
 * unfreezes with the whole backlog in one reading. Observed on 2026-05-21,
 * 2026-06-24, and consecutively on 2026-08-02/03. The old ingest recorded the
 * zero delta as a factual 0 and the backlog as one enormous day.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyViews, MAX_PLAUSIBLE_DAILY_VIEWS, type DeltaPoint } from './view-delta';

const pt = (date: string, total_views: number | null): DeltaPoint => ({ date, total_views });

test('computeDailyViews: first row has no prior, so no delta', () => {
  const r = computeDailyViews([pt('2026-08-01', 1000)]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    date: '2026-08-01', daily_views: null, imputed: false, delta_span_days: null,
  });
});

test('computeDailyViews: clean series → plain 1-day deltas, nothing imputed', () => {
  const r = computeDailyViews([
    pt('2026-08-01', 1000), pt('2026-08-02', 1500), pt('2026-08-03', 2200),
  ]);
  assert.deepEqual(r.map((x) => x.daily_views), [null, 500, 700]);
  assert.deepEqual(r.map((x) => x.imputed), [false, false, false]);
  assert.deepEqual(r.map((x) => x.delta_span_days), [null, 1, 1]);
});

test('computeDailyViews: the REAL 2026-08-02/03 TIPSMUSIC freeze', () => {
  // Cumulative totals exactly as recorded in fct_channel_daily.
  const r = computeDailyViews([
    pt('2026-07-31', 83_159_280_297),
    pt('2026-08-01', 83_203_984_130),
    pt('2026-08-02', 83_203_984_130), // frozen
    pt('2026-08-03', 83_203_984_130), // frozen
    pt('2026-08-04', 83_342_980_272), // unfreeze: 3 days of backlog
    pt('2026-08-05', 83_385_096_274),
  ]);
  // Aug 1 is a clean day and must NOT be swept into the plateau.
  assert.equal(r[1].daily_views, 44_703_833);
  assert.equal(r[1].imputed, false);

  // Aug 2-4 share the 138,996,142 backlog across a 3-day span.
  const smeared = r.slice(2, 5);
  assert.deepEqual(smeared.map((x) => x.delta_span_days), [3, 3, 3]);
  assert.deepEqual(smeared.map((x) => x.imputed), [true, true, true]);
  assert.deepEqual(smeared.map((x) => x.daily_views), [46_332_047, 46_332_047, 46_332_048]);

  // The total must be preserved EXACTLY - remainder rides on the last day.
  assert.equal(smeared.reduce((a, x) => a + (x.daily_views ?? 0), 0), 138_996_142);

  // Aug 5 returns to normal.
  assert.equal(r[5].daily_views, 42_116_002);
  assert.equal(r[5].imputed, false);
});

test('computeDailyViews: single frozen day → 2-day span', () => {
  const r = computeDailyViews([
    pt('2026-06-23', 1_000), pt('2026-06-24', 1_000), pt('2026-06-25', 1_100),
  ]);
  assert.deepEqual(r.map((x) => x.daily_views), [null, 50, 50]);
  assert.deepEqual(r.map((x) => x.imputed), [false, true, true]);
  assert.deepEqual(r.map((x) => x.delta_span_days), [null, 2, 2]);
});

test('computeDailyViews: unresolved freeze at the end stays null, never a false zero', () => {
  // The freeze has not lifted yet - we genuinely do not know the split.
  const r = computeDailyViews([
    pt('2026-08-01', 1000), pt('2026-08-02', 1000), pt('2026-08-03', 1000),
  ]);
  assert.deepEqual(r.map((x) => x.daily_views), [null, null, null]);
  assert.deepEqual(r.map((x) => x.imputed), [false, false, false]);
});

test('computeDailyViews: negative delta (counter reset) is unknown, not imputed', () => {
  const r = computeDailyViews([pt('2026-08-01', 5000), pt('2026-08-02', 4000)]);
  assert.equal(r[1].daily_views, null);
  assert.equal(r[1].imputed, false);
});

test('computeDailyViews: a negative reading does not anchor a later redistribution', () => {
  // 4000 then 4600: the +600 must be a plain 1-day delta, not smeared back
  // across the reset.
  const r = computeDailyViews([
    pt('2026-08-01', 5000), pt('2026-08-02', 4000), pt('2026-08-03', 4600),
  ]);
  assert.equal(r[2].daily_views, 600);
  assert.equal(r[2].delta_span_days, 1);
  assert.equal(r[2].imputed, false);
});

test('computeDailyViews: null total_views yields null and breaks the run', () => {
  const r = computeDailyViews([
    pt('2026-08-01', 1000), pt('2026-08-02', null), pt('2026-08-03', 1600),
  ]);
  assert.equal(r[1].daily_views, null);
  assert.equal(r[2].daily_views, null); // prior is unknown → delta uncomputable
});

test('computeDailyViews: long freeze redistributes evenly and preserves the sum', () => {
  const series = [pt('2026-08-01', 0)];
  for (let i = 2; i <= 6; i++) series.push(pt(`2026-08-0${i}`, 0)); // 5 frozen days
  series.push(pt('2026-08-07', 1_000_003)); // unfreeze, awkward remainder
  const r = computeDailyViews(series);
  const span = r.slice(1);
  assert.ok(span.every((x) => x.delta_span_days === 6 && x.imputed));
  assert.equal(span.reduce((a, x) => a + (x.daily_views ?? 0), 0), 1_000_003);
  // Even split with the remainder on the final day.
  assert.deepEqual(span.map((x) => x.daily_views), [166667, 166667, 166667, 166667, 166667, 166668]);
});

test('computeDailyViews: empty input', () => {
  assert.deepEqual(computeDailyViews([]), []);
});

// --- implausible jumps (catalog restatements) --------------------------------

test('computeDailyViews: the REAL 2026-06-06 Saregama restatement is rejected', () => {
  // The channel runs ~21-25M/day, then the cumulative count jumped by 1.02bn in
  // one reading - a YouTube-side catalog reassignment, not viewership.
  const r = computeDailyViews([
    pt('2026-06-05', 34_433_091_222),
    pt('2026-06-06', 35_451_697_880), // +1,018,606,658
    pt('2026-06-07', 35_477_470_191),
  ]);
  assert.equal(r[1].daily_views, null, 'restatement must not be recorded as views');
  assert.equal(r[1].imputed, false);
  assert.equal(r[1].delta_span_days, null);
  // The following day is still an ordinary 1-day delta.
  assert.equal(r[2].daily_views, 25_772_311);
});

test('computeDailyViews: ceiling applies PER DAY, not to the raw multi-day delta', () => {
  // A 5-day freeze on a big channel: the catch-up totals 225M, which exceeds
  // the per-day ceiling outright - but 45M/day is entirely ordinary, so the
  // data must be kept, not discarded.
  const series: DeltaPoint[] = [pt('2026-03-01', 0)];
  for (let i = 2; i <= 5; i++) series.push(pt(`2026-03-0${i}`, 0));
  series.push(pt('2026-03-06', 225_000_000));
  const r = computeDailyViews(series);
  const span = r.slice(1);
  assert.ok(span.every((x) => x.delta_span_days === 5 && x.imputed));
  assert.equal(span.reduce((a, x) => a + (x.daily_views ?? 0), 0), 225_000_000);
  assert.equal(span[0].daily_views, 45_000_000);
});

test('computeDailyViews: a catch-up whose PER-DAY rate is implausible is rejected wholesale', () => {
  const r = computeDailyViews([
    pt('2026-03-01', 0), pt('2026-03-02', 0), pt('2026-03-03', 900_000_000),
  ]);
  assert.deepEqual(r.map((x) => x.daily_views), [null, null, null]);
  assert.deepEqual(r.map((x) => x.imputed), [false, false, false]);
});

test('computeDailyViews: a restatement breaks the pending run', () => {
  // Frozen, then an implausible jump: the frozen day can never be resolved and
  // must not be back-filled by the NEXT ordinary delta.
  const r = computeDailyViews([
    pt('2026-03-01', 1_000_000),
    pt('2026-03-02', 1_000_000),      // frozen
    pt('2026-03-03', 999_000_000),    // restatement
    pt('2026-03-04', 999_050_000),    // ordinary +50k
  ]);
  assert.equal(r[1].daily_views, null);
  assert.equal(r[2].daily_views, null);
  assert.equal(r[3].daily_views, 50_000);
  assert.equal(r[3].delta_span_days, 1, 'must not absorb the stranded frozen day');
});

test('MAX_PLAUSIBLE_DAILY_VIEWS sits inside the DB CHECK constraint (< 500m)', () => {
  assert.ok(MAX_PLAUSIBLE_DAILY_VIEWS < 500_000_000);
});

// --- date gaps (missing rows, not frozen readings) ---------------------------

test('computeDailyViews: a date GAP records the true span but keeps the value whole', () => {
  // Rows exist for Mar 1 and Mar 10 only. The +900k covers 9 days, but there
  // are no rows for Mar 2-9 to spread it across, so the value stays whole and
  // the span records what it really covers. Not imputed: nothing was invented.
  const r = computeDailyViews([pt('2026-03-01', 100_000), pt('2026-03-10', 1_000_000)]);
  assert.equal(r[1].daily_views, 900_000, 'total must be preserved');
  assert.equal(r[1].delta_span_days, 9, 'span must reflect the real coverage');
  assert.equal(r[1].imputed, false, 'no per-day split was invented');
});

test('computeDailyViews: contiguous frozen rows still redistribute (span == row count)', () => {
  // Distinguishes a freeze (rows present) from a gap (rows absent).
  const r = computeDailyViews([
    pt('2026-03-01', 100_000), pt('2026-03-02', 100_000), pt('2026-03-03', 400_000),
  ]);
  assert.deepEqual(r.map((x) => x.daily_views), [null, 150_000, 150_000]);
  assert.ok(r.slice(1).every((x) => x.imputed && x.delta_span_days === 2 + 1 - 1));
});

test('computeDailyViews: gap AND freeze together — span from dates, value whole', () => {
  // Mar 1, then a frozen Mar 5, then Mar 8 resolves. Rows are missing for
  // Mar 2-4 and Mar 6-7, so an even split is not available.
  const r = computeDailyViews([
    pt('2026-03-01', 100_000), pt('2026-03-05', 100_000), pt('2026-03-08', 800_000),
  ]);
  assert.equal(r[2].daily_views, 700_000);
  assert.equal(r[2].delta_span_days, 7);
  assert.equal(r[2].imputed, false);
});
