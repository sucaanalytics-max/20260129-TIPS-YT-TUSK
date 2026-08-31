/**
 * Tests for quarter/year bucketing and regime- and completeness-aware comparison.
 * Run: `npx tsx --test v2/lib/period-compare.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  periodKey,
  periodBounds,
  dayIndexInPeriod,
  bucketByPeriod,
  comparePeriods,
  REGIME_BREAK,
  type DatedValue,
} from './period-compare';

const DAY = 86_400_000;

/** One row per calendar day from `from` to `to` inclusive, all the same value. */
function daily(from: string, to: string, value: number | null): DatedValue[] {
  const out: DatedValue[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY) {
    out.push({ date: new Date(t).toISOString().slice(0, 10), value });
  }
  return out;
}

test('periodKey: quarters and years', () => {
  assert.equal(periodKey('2026-08-27', 'quarter'), '2026-Q3');
  assert.equal(periodKey('2026-01-01', 'quarter'), '2026-Q1');
  assert.equal(periodKey('2025-12-31', 'quarter'), '2025-Q4');
  assert.equal(periodKey('2026-08-27', 'year'), '2026');
});

test('periodBounds: calendar length of each bucket, leap years included', () => {
  assert.deepEqual(periodBounds('2026-Q3'), {
    start: '2026-07-01',
    end: '2026-09-30',
    expectedDays: 92,
  });
  assert.deepEqual(periodBounds('2026-Q2'), {
    start: '2026-04-01',
    end: '2026-06-30',
    expectedDays: 91,
  });
  assert.equal(periodBounds('2026-Q1').expectedDays, 90);
  assert.equal(periodBounds('2024-Q1').expectedDays, 91); // leap
  assert.equal(periodBounds('2026').expectedDays, 365);
  assert.equal(periodBounds('2024').expectedDays, 366);
});

test('dayIndexInPeriod: 1-based within the calendar period', () => {
  assert.equal(dayIndexInPeriod('2026-07-01', 'quarter'), 1);
  assert.equal(dayIndexInPeriod('2026-08-30', 'quarter'), 61);
  assert.equal(dayIndexInPeriod('2026-01-01', 'year'), 1);
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

test('bucketByPeriod: a full quarter is complete; an in-flight one is not', () => {
  const full = bucketByPeriod(daily('2026-04-01', '2026-06-30', 1), 'quarter')[0];
  assert.equal(full.expectedDays, 91);
  assert.equal(full.elapsedDays, 91);
  assert.equal(full.complete, true);

  const inflight = bucketByPeriod(daily('2026-07-01', '2026-08-30', 1), 'quarter')[0];
  assert.equal(inflight.expectedDays, 92);
  assert.equal(inflight.elapsedDays, 61);
  assert.equal(inflight.complete, false);
});

test('bucketByPeriod: frozen-reading nulls leave the period short of whole', () => {
  // 0026_view_delta_repair.sql leaves NULL readings on some days. The rows are
  // there but they carry no value, and `total` only ever sums values - so the
  // period is NOT whole for the purpose of a period-over-period percentage.
  //
  // This test previously asserted complete === true and never checked what
  // changePct then did. It did: a flat business printed a red collapse equal to
  // the missing share, with no caveat, because the calendar was whole while the
  // total was not.
  const rows = [
    ...daily('2026-04-01', '2026-06-28', 1),
    { date: '2026-06-29', value: null },
    { date: '2026-06-30', value: null },
  ];
  const b = bucketByPeriod(rows, 'quarter')[0];
  assert.equal(b.days, 89);
  assert.equal(b.missing, 2);
  assert.equal(b.complete, false);
});

test('comparePeriods: a freeze does not turn a flat business into a collapse', () => {
  // Both quarters wholly post-regime-break, a perfectly flat 100/day. Q3 has an
  // 8-day freeze: rows present, values null. The whole-period percentage must be
  // withheld, and the like-for-like figure over the days both quarters actually
  // measured must report the truth, which is 0%.
  const rows = [
    ...daily('2026-04-01', '2026-06-30', 100),
    ...daily('2026-07-01', '2026-09-22', 100),
    ...Array.from({ length: 8 }, (_, i) => ({
      date: `2026-09-${String(23 + i).padStart(2, '0')}`,
      value: null,
    })),
  ];
  const c = comparePeriods(rows, 'quarter');
  const q3 = c[c.length - 1];

  assert.equal(q3.complete, false);
  assert.equal(q3.changePct, null, 'the whole-period percentage is a freeze artefact');
  assert.ok(q3.caveat, 'a withheld percentage must say why');
  // The honest answer, on the days both quarters measured.
  assert.equal(Math.round(q3.partialChangePct!), 0);
});

test('comparePeriods: percentage change against the prior period', () => {
  const rows = [...daily('2026-04-01', '2026-06-30', 100), ...daily('2026-07-01', '2026-09-30', 150)];
  const c = comparePeriods(rows, 'quarter');
  const latest = c[c.length - 1];
  assert.equal(latest.key, '2026-Q3');
  assert.equal(latest.total, 92 * 150);
  assert.equal(latest.priorTotal, 91 * 100);
  assert.equal(latest.comparable, true);
  assert.ok(Math.abs(latest.changePct! - 51.65) < 0.01);
});

test('comparePeriods: the first period has no prior', () => {
  const c = comparePeriods(daily('2026-04-01', '2026-06-30', 100), 'quarter');
  assert.equal(c[0].priorTotal, null);
  assert.equal(c[0].changePct, null);
});

test('comparePeriods: a comparison across the regime break is marked not-like-for-like', () => {
  const rows = [
    ...daily('2025-10-01', '2025-12-31', 100), // legacy quarter
    ...daily('2026-04-01', '2026-06-30', 150), // current quarter
  ];
  const c = comparePeriods(rows, 'quarter');
  const latest = c[c.length - 1];
  assert.equal(latest.comparable, false);
  assert.ok(latest.caveat && latest.caveat.includes(REGIME_BREAK));
  // The regime guard is untouched by the completeness work: both periods are
  // whole, so the percentage is still printed (the UI paints it as a warning).
  assert.notEqual(latest.changePct, null);
});

test('comparePeriods: same-regime whole-period comparison is like-for-like', () => {
  const rows = [...daily('2026-04-01', '2026-06-30', 100), ...daily('2026-07-01', '2026-09-30', 150)];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.comparable, true);
  assert.equal(latest.caveat, null);
});

test('comparePeriods: division by zero yields null, not Infinity', () => {
  const rows = [...daily('2026-04-01', '2026-06-30', 0), ...daily('2026-07-01', '2026-09-30', 5)];
  assert.equal(comparePeriods(rows, 'quarter').at(-1)!.changePct, null);
});

test('comparePeriods: an in-flight quarter withholds the whole-period percentage', () => {
  // The production case: flat 10M views/day all year, read on 2026-08-31.
  // 2026-Q2 = 91 whole days, 2026-Q3 = 61 of 92. Nothing about the business
  // changed, so nothing may be printed that says it fell by a third.
  const rows = [
    ...daily('2026-04-01', '2026-06-30', 10_000_000),
    ...daily('2026-07-01', '2026-08-30', 10_000_000),
  ];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.key, '2026-Q3');
  assert.equal(latest.complete, false);
  assert.equal(latest.comparable, false);
  assert.equal(latest.changePct, null); // NOT -33%
  assert.ok(latest.caveat!.includes('61 of 92 days'));
  assert.ok(latest.caveat!.includes('91 of 91 days') === false);
});

test('comparePeriods: the in-flight quarter still offers an explicit like-for-like', () => {
  const rows = [
    ...daily('2026-04-01', '2026-06-30', 10_000_000),
    ...daily('2026-07-01', '2026-08-30', 10_000_000),
  ];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.sharedDays, 61);
  assert.equal(latest.partialTotal, 61 * 10_000_000);
  assert.equal(latest.priorPartialTotal, 61 * 10_000_000);
  assert.equal(latest.partialChangePct, 0); // a flat business reads as flat
});

test('comparePeriods: like-for-like reports a real move on the elapsed slice', () => {
  const rows = [
    ...daily('2026-04-01', '2026-06-30', 100),
    ...daily('2026-07-01', '2026-08-30', 120),
  ];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.changePct, null);
  assert.equal(latest.sharedDays, 61);
  assert.ok(Math.abs(latest.partialChangePct! - 20) < 1e-9);
});

test('comparePeriods: the first day of a quarter is not a 98% collapse', () => {
  const rows = [...daily('2026-07-01', '2026-09-30', 100), { date: '2026-10-01', value: 100 }];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.key, '2026-Q4');
  assert.equal(latest.changePct, null);
  assert.equal(latest.sharedDays, 1);
  assert.equal(latest.partialChangePct, 0);
});

test('comparePeriods: a leading-edge stub also blocks the whole-period percentage', () => {
  // The series starts 2023-01-04, so 2023-Q1 holds 87 of 90 days. Comparing a
  // whole 2023-Q2 against that stub inflates the change; it is withheld too.
  const rows = [...daily('2023-01-04', '2023-03-31', 100), ...daily('2023-04-01', '2023-06-30', 100)];
  const c = comparePeriods(rows, 'quarter');
  assert.equal(c[0].complete, false);
  assert.equal(c[1].complete, true);
  assert.equal(c[1].changePct, null);
  assert.ok(c[1].caveat!.includes('87 of 90 days'));
  assert.equal(c[1].sharedDays, 87); // like-for-like on the days both measured
  assert.equal(c[1].partialChangePct, 0);
});

test('comparePeriods: like-for-like is never offered across the regime break', () => {
  const rows = [
    ...daily('2025-10-01', '2025-12-31', 100), // legacy
    ...daily('2026-01-01', '2026-03-31', 100), // straddles the break
    ...daily('2026-04-01', '2026-05-15', 100), // in flight, current
  ];
  const latest = comparePeriods(rows, 'quarter').at(-1)!;
  assert.equal(latest.comparable, false);
  assert.equal(latest.changePct, null);
  assert.equal(latest.sharedDays, null);
  assert.equal(latest.partialChangePct, null);
  assert.ok(latest.caveat!.includes(REGIME_BREAK));
});

test('comparePeriods: a calendar year in flight withholds the percentage too', () => {
  // Both years sit wholly after the regime break, so completeness is the only
  // obstacle and the like-for-like slice is offered.
  const rows = [...daily('2027-01-01', '2027-12-31', 10), ...daily('2028-01-01', '2028-08-30', 10)];
  const latest = comparePeriods(rows, 'year').at(-1)!;
  assert.equal(latest.key, '2028');
  assert.equal(latest.expectedDays, 366); // leap
  assert.equal(latest.complete, false);
  assert.equal(latest.changePct, null);
  assert.equal(latest.sharedDays, 243);
  assert.equal(latest.partialChangePct, 0);
});

test('comparePeriods: a calendar year straddling the break gets no like-for-like', () => {
  // 2026 spans 2026-02-16, so it is 'mixed' and the regime guard rules first.
  const rows = [...daily('2025-01-01', '2025-12-31', 10), ...daily('2026-01-01', '2026-08-30', 10)];
  const latest = comparePeriods(rows, 'year').at(-1)!;
  assert.equal(latest.key, '2026');
  assert.equal(latest.regime, 'mixed');
  assert.equal(latest.changePct, null);
  assert.equal(latest.sharedDays, null);
  assert.ok(latest.caveat!.includes(REGIME_BREAK));
  assert.ok(latest.caveat!.includes('242 of 365 days'));
});

test('comparePeriods: no NaN or Infinity ever reaches a caller', () => {
  const rows = [
    ...daily('2026-04-01', '2026-06-30', 0),
    ...daily('2026-07-01', '2026-08-30', 0),
  ];
  const c = comparePeriods(rows, 'quarter');
  for (const p of c) {
    for (const v of [p.changePct, p.partialChangePct, p.partialTotal, p.priorPartialTotal]) {
      assert.ok(v == null || Number.isFinite(v), `${p.key}: ${v}`);
    }
    assert.ok(Number.isFinite(p.total) && Number.isFinite(p.expectedDays));
  }
});

test('REGIME_BREAK is the first per-channel day', () => {
  assert.equal(REGIME_BREAK, '2026-02-16');
});
