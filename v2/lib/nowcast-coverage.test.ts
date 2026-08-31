import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  imputePerChannel,
  imputeByDayCoverage,
  type ChannelDayReading,
} from './nowcast-coverage';

// ---- imputePerChannel ------------------------------------------------------

const reading = (channelId: string, date: string, value: number | null): ChannelDayReading => ({
  channelId,
  date,
  value,
});

const dates = (n: number, from = 1): string[] =>
  Array.from({ length: n }, (_, i) => `2026-07-${String(from + i).padStart(2, '0')}`);

test('complete coverage is a pure sum — imputation is a no-op', () => {
  const readings = dates(4).flatMap((d) => [reading('a', d, 100), reading('b', d, 10)]);
  const r = imputePerChannel({ readings, channelIds: ['a', 'b'], elapsedDays: 4 });
  assert.ok(r);
  assert.equal(r.views, 440);
  assert.equal(r.observedDays, 4);
  assert.equal(r.channelsWithNoReading, 0);
});

test('a frozen big channel is imputed at its OWN mean, not the roster mean', () => {
  // 'big' does 1000/day, 'small' does 10/day. 'big' freezes on day 4.
  const readings: ChannelDayReading[] = [];
  for (const d of dates(4)) {
    readings.push(reading('big', d, d === '2026-07-04' ? null : 1000));
    readings.push(reading('small', d, 10));
  }
  const r = imputePerChannel({ readings, channelIds: ['big', 'small'], elapsedDays: 4 });
  assert.ok(r);
  // big: 3000 observed over 3 days -> 4000. small: 40 measured. Never 3040.
  assert.equal(r.views, 4040);
  // Day 4 is not a fully observed day.
  assert.equal(r.observedDays, 3);
});

test('days absent from the data are imputed, not treated as zero', () => {
  // Only 2 of 10 elapsed days present.
  const readings = dates(2).flatMap((d) => [reading('a', d, 50)]);
  const r = imputePerChannel({ readings, channelIds: ['a'], elapsedDays: 10 });
  assert.ok(r);
  assert.equal(r.views, 500);
  assert.equal(r.observedDays, 2);
  assert.equal(r.elapsedDays, 10);
});

test('a channel that never reported is counted, not silently imputed as zero', () => {
  const readings = dates(3).map((d) => reading('a', d, 100));
  const r = imputePerChannel({ readings, channelIds: ['a', 'dead'], elapsedDays: 3 });
  assert.ok(r);
  assert.equal(r.views, 300);
  assert.equal(r.channelsTracked, 2);
  assert.equal(r.channelsWithNoReading, 1);
  // 'dead' must not drag every day into "partial" — a is fully observed.
  assert.equal(r.observedDays, 3);
});

test('nothing measured returns null rather than zero', () => {
  const readings = dates(3).map((d) => reading('a', d, null));
  assert.equal(imputePerChannel({ readings, channelIds: ['a'], elapsedDays: 3 }), null);
  assert.equal(imputePerChannel({ readings: [], channelIds: ['a'], elapsedDays: 3 }), null);
  assert.equal(imputePerChannel({ readings, channelIds: [], elapsedDays: 3 }), null);
});

test('a non-positive or non-finite window returns null', () => {
  const readings = [reading('a', '2026-07-01', 5)];
  assert.equal(imputePerChannel({ readings, channelIds: ['a'], elapsedDays: 0 }), null);
  assert.equal(imputePerChannel({ readings, channelIds: ['a'], elapsedDays: -1 }), null);
  assert.equal(imputePerChannel({ readings, channelIds: ['a'], elapsedDays: NaN }), null);
});

test('untracked channels and duplicate rows do not distort the mean', () => {
  const readings = [
    reading('a', '2026-07-01', 100),
    reading('a', '2026-07-01', 100), // duplicate row for the same day
    reading('ghost', '2026-07-01', 9_999), // not in the roster
  ];
  const r = imputePerChannel({ readings, channelIds: ['a'], elapsedDays: 2 });
  assert.ok(r);
  assert.equal(r.views, 200);
});

test('the result is an integer — a fractional view does not exist', () => {
  const readings = [reading('a', '2026-07-01', 100), reading('a', '2026-07-02', 101)];
  const r = imputePerChannel({ readings, channelIds: ['a'], elapsedDays: 3 });
  assert.ok(r);
  assert.equal(Number.isInteger(r.views), true);
  assert.equal(r.views, 302); // 201 / 2 * 3 = 301.5 -> 302
});

// ---- imputeByDayCoverage ---------------------------------------------------

test('a fully covered window is a pure sum', () => {
  const days = dates(3).map((date) => ({ date, value: 100, channelsReporting: 10 }));
  const r = imputeByDayCoverage({ days, elapsedDays: 3 });
  assert.ok(r);
  assert.equal(r.views, 300);
  assert.equal(r.observedDays, 3);
  assert.equal(r.partialDays, 0);
  assert.equal(r.expectedChannels, 10);
});

test('a half-reported day counts as half a day of exposure, not a whole one', () => {
  const days = [
    { date: '2026-07-01', value: 100, channelsReporting: 10 },
    { date: '2026-07-02', value: 50, channelsReporting: 5 },
  ];
  const r = imputeByDayCoverage({ days, elapsedDays: 2 });
  assert.ok(r);
  // 150 observed over 1.5 day-equivalents -> 100/day -> 200 over 2 days.
  assert.equal(r.views, 200);
  assert.equal(r.observedDays, 1);
  assert.equal(r.partialDays, 1);
  assert.equal(r.coverageDays, 1.5);
});

test('missing days are imputed at the observed daily rate', () => {
  const days = [
    { date: '2026-07-01', value: 100, channelsReporting: 4 },
    { date: '2026-07-02', value: 100, channelsReporting: 4 },
  ];
  const r = imputeByDayCoverage({ days, elapsedDays: 10 });
  assert.ok(r);
  assert.equal(r.views, 1000);
});

test('a measured zero is kept as zero, but measuring nothing returns null', () => {
  const measuredZero = imputeByDayCoverage({
    days: [{ date: '2026-07-01', value: 0, channelsReporting: 3 }],
    elapsedDays: 2,
  });
  assert.ok(measuredZero);
  assert.equal(measuredZero.views, 0);
  assert.equal(measuredZero.observedDays, 1);

  // No usable day at all: null, so the caller can refuse rather than report 0.
  assert.equal(
    imputeByDayCoverage({
      days: [{ date: '2026-07-01', value: null, channelsReporting: 0 }],
      elapsedDays: 2,
    }),
    null,
  );
  assert.equal(imputeByDayCoverage({ days: [], elapsedDays: 2 }), null);
});

test('a day with a value but no reporting channels is not usable', () => {
  assert.equal(
    imputeByDayCoverage({
      days: [{ date: '2026-07-01', value: 500, channelsReporting: 0 }],
      elapsedDays: 1,
    }),
    null,
  );
});

test('duplicate dates are counted once', () => {
  const days = [
    { date: '2026-07-01', value: 100, channelsReporting: 5 },
    { date: '2026-07-01', value: 100, channelsReporting: 5 },
  ];
  const r = imputeByDayCoverage({ days, elapsedDays: 1 });
  assert.ok(r);
  assert.equal(r.views, 100);
});

test('a non-positive window returns null', () => {
  const days = [{ date: '2026-07-01', value: 10, channelsReporting: 1 }];
  assert.equal(imputeByDayCoverage({ days, elapsedDays: 0 }), null);
  assert.equal(imputeByDayCoverage({ days, elapsedDays: NaN }), null);
});

test('the FY27 Q2 production shape: 54 of 62 days observed', () => {
  // 54 complete days at a flat rate; 8 elapsed days carry nothing at all.
  const days = Array.from({ length: 54 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    value: 20_000_000,
    channelsReporting: 16,
  }));
  const r = imputeByDayCoverage({ days, elapsedDays: 62 });
  assert.ok(r);
  assert.equal(r.views, 62 * 20_000_000);
  // The naive sum would have been ~13% low.
  const naive = 54 * 20_000_000;
  assert.ok(naive / r.views < 0.88);
});

/* ---- exposure is measured in calendar days, not rows ---------------------
 *
 * Migration 0026 does not always spread a resolved freeze. Where rows are
 * missing for part of the span it keeps the catch-up WHOLE on the unfreeze day
 * and records the span, so one row can hold several days of views. Counting
 * rows treats that channel as under-observed and scales a total that is
 * already complete.
 */

test('imputePerChannel: a whole catch-up is not imputed a second time', () => {
  // The audit's case. 10-day window, true 100 views/day = 1000 total.
  // Days 1-6 normal, day 7 frozen (NULL), day 8 row absent, day 9 frozen
  // (NULL), day 10 carries the whole 400-view backlog with span 4.
  const readings = [
    ...Array.from({ length: 6 }, (_, i) => ({
      channelId: 'X',
      date: `2026-07-0${i + 1}`,
      value: 100,
      spanDays: 1,
    })),
    { channelId: 'X', date: '2026-07-07', value: null, spanDays: null },
    { channelId: 'X', date: '2026-07-09', value: null, spanDays: null },
    { channelId: 'X', date: '2026-07-10', value: 400, spanDays: 4 },
  ];
  const got = imputePerChannel({ readings, channelIds: ['X'], elapsedDays: 10 });
  // Exposure = 6x1 + 4 = 10 days, which is the whole window: nothing to impute.
  assert.equal(got!.views, 1000);
  // Counting rows would give exposure 7 and 1000 * 10/7 = 1429, i.e. +43%.
  assert.notEqual(got!.views, 1429);
});

test('imputePerChannel: still imputes a genuinely unobserved day', () => {
  // Same channel, but the last day never unfroze — no catch-up row at all.
  // Exposure is 6 of 10 days and the shortfall is real.
  const readings = Array.from({ length: 6 }, (_, i) => ({
    channelId: 'X',
    date: `2026-07-0${i + 1}`,
    value: 100,
    spanDays: 1,
  }));
  const got = imputePerChannel({ readings, channelIds: ['X'], elapsedDays: 10 });
  assert.equal(got!.views, 1000); // 600 * 10/6
});

test('imputePerChannel: a span reaching past the window start cannot deflate', () => {
  // The catch-up covers 5 days but only 2 are inside the window. Its value
  // already carries the pre-window views, so exposure is clamped to the window
  // rather than allowed to exceed it and scale the total DOWN.
  const readings = [{ channelId: 'X', date: '2026-07-02', value: 500, spanDays: 5 }];
  const got = imputePerChannel({ readings, channelIds: ['X'], elapsedDays: 2 });
  assert.equal(got!.views, 500);
});

test('imputePerChannel: a spread value is exposure but is not an observed day', () => {
  // 0026: "never present it as measured."
  const readings = [
    { channelId: 'X', date: '2026-07-01', value: 100, spanDays: 1, imputed: false },
    { channelId: 'X', date: '2026-07-02', value: 100, spanDays: 1, imputed: true },
  ];
  const got = imputePerChannel({ readings, channelIds: ['X'], elapsedDays: 2 });
  assert.equal(got!.views, 200);
  assert.equal(got!.observedDays, 1);
  assert.equal(got!.imputedDays, 1);
});

test('imputePerChannel: a missing span is treated as one day', () => {
  // delta_span_days is NULL for "not computable" — it must not become 0 and
  // make exposure collapse toward a divide-by-zero.
  const readings = [
    { channelId: 'X', date: '2026-07-01', value: 100 },
    { channelId: 'X', date: '2026-07-02', value: 100, spanDays: null },
    { channelId: 'X', date: '2026-07-03', value: 100, spanDays: 0 },
  ];
  const got = imputePerChannel({ readings, channelIds: ['X'], elapsedDays: 6 });
  assert.equal(got!.views, 600); // exposure 3 of 6
});

test('imputeByDayCoverage: a catch-up day is not scaled up for its own freeze', () => {
  // Two channels. Day 2 has only one contributor, but that contributor's value
  // covers 2 channel-days, so the day is fully covered, not half covered.
  const days = [
    { date: '2026-07-01', value: 200, channelsReporting: 2, channelDaysCovered: 2 },
    { date: '2026-07-02', value: 200, channelsReporting: 1, channelDaysCovered: 2 },
  ];
  const got = imputeByDayCoverage({ days, elapsedDays: 2 });
  assert.equal(got!.views, 400);
  // Without the span signal this reads as 1.5 days of coverage and inflates to 533.
  assert.notEqual(got!.views, 533);
});
