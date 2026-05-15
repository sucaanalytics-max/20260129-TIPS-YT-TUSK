/**
 * Tests for v2/lib/risk.ts. Run with `npm test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logReturns,
  annualizedVolatility,
  maxDrawdown,
  beta,
  cumulativeRelativePerformance,
  periodReturn,
  returnSinceDate,
  fiftyTwoWeekRange,
} from './risk';

// --- logReturns -------------------------------------------------------------

test('logReturns: skips consecutive pairs touching null or non-positive', () => {
  // Consecutive pairs: (100,null) (null,110) (110,0) (0,121) — all invalid.
  // Convention: don't bridge across gaps; skip the gap entirely.
  const r = logReturns([100, null, 110, 0, 121]);
  assert.equal(r.length, 0);
});

test('logReturns: clean series returns n-1 log returns', () => {
  const r = logReturns([100, 110, 121]);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0] - Math.log(110 / 100)) < 1e-9);
  assert.ok(Math.abs(r[1] - Math.log(121 / 110)) < 1e-9);
});

test('logReturns: monotone series gives positive log returns', () => {
  const r = logReturns([100, 105, 110, 115]);
  assert.equal(r.length, 3);
  for (const x of r) assert.ok(x > 0);
});

// --- annualizedVolatility ---------------------------------------------------

test('annualizedVolatility: null when too few returns', () => {
  assert.equal(annualizedVolatility([0.01, 0.02]), null);
});

test('annualizedVolatility: zero-vol returns yields zero', () => {
  const r = Array.from({ length: 100 }, () => 0.005);
  const v = annualizedVolatility(r);
  assert.ok(v != null && Math.abs(v) < 1e-9);
});

test('annualizedVolatility: scales daily stddev by sqrt(252)', () => {
  // daily stddev of 1% → annualized should be ≈ 0.01 * sqrt(252) ≈ 0.1587
  const r: number[] = [];
  // Build a series with daily stddev ≈ 0.01 deterministically.
  for (let i = 0; i < 100; i++) r.push((i % 2 === 0 ? 1 : -1) * 0.01);
  const v = annualizedVolatility(r);
  assert.ok(v != null);
  // The expected annualized vol is sqrt(252) * stddev(r).
  // Tolerate 1% drift.
  const expected = 0.01 * Math.sqrt(252);
  assert.ok(Math.abs((v as number) - expected) / expected < 0.05);
});

// --- maxDrawdown ------------------------------------------------------------

test('maxDrawdown: monotonically rising prices → zero drawdown', () => {
  const dd = maxDrawdown([100, 105, 110, 115, 120]);
  assert.ok(dd != null && dd.drawdown_pct === 0);
});

test('maxDrawdown: rise then fall captures correct peak and trough', () => {
  // 100, 110, 120 (peak idx=2), then fall to 90 (trough idx=4)
  const dd = maxDrawdown([100, 110, 120, 100, 90]);
  assert.ok(dd != null);
  assert.equal(dd!.peak_idx, 2);
  assert.equal(dd!.trough_idx, 4);
  // drawdown from 120 to 90 = -0.25
  assert.ok(Math.abs(dd!.drawdown_pct + 0.25) < 1e-9);
});

test('maxDrawdown: handles nulls without breaking', () => {
  const dd = maxDrawdown([100, null, 120, null, 80]);
  assert.ok(dd != null);
  assert.ok(dd!.drawdown_pct < 0);
});

test('maxDrawdown: returns null for short series', () => {
  assert.equal(maxDrawdown([100]), null);
  assert.equal(maxDrawdown([]), null);
});

// --- beta -------------------------------------------------------------------

test('beta: identical series → beta = 1', () => {
  const r = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 0.01 : -0.005));
  const b = beta(r, r);
  assert.ok(b != null && Math.abs((b as number) - 1) < 1e-9);
});

test('beta: stock = 2 * index → beta ≈ 2', () => {
  const idx = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 0.01);
  const stock = idx.map((x) => x * 2);
  const b = beta(stock, idx);
  assert.ok(b != null && Math.abs((b as number) - 2) < 1e-9);
});

test('beta: null for zero-variance index', () => {
  const stock = [0.01, 0.02, -0.01, 0.005, 0.0, -0.02, 0.01, -0.005, 0.015, -0.01];
  const idx = Array(stock.length).fill(0);
  assert.equal(beta(stock, idx), null);
});

test('beta: null when lengths differ', () => {
  assert.equal(beta([0.01, 0.02], [0.01, 0.02, 0.03]), null);
});

// --- cumulativeRelativePerformance ------------------------------------------

test('cumulativeRelativePerformance: matched moves → flat rel-perf', () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const stock = dates.map((d, i) => ({ date: d, close: 100 * 1.01 ** i }));
  const index = dates.map((d, i) => ({ date: d, close: 100 * 1.01 ** i }));
  const rel = cumulativeRelativePerformance(stock, index);
  assert.equal(rel.length, 10);
  for (const r of rel) assert.ok(Math.abs(r.rel) < 1e-9);
});

test('cumulativeRelativePerformance: outperforming stock → positive last point', () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const stock = dates.map((d, i) => ({ date: d, close: 100 * 1.02 ** i }));
  const index = dates.map((d, i) => ({ date: d, close: 100 * 1.01 ** i }));
  const rel = cumulativeRelativePerformance(stock, index);
  assert.equal(rel[0].rel, 0);
  assert.ok(rel[rel.length - 1].rel > 0);
});

// --- periodReturn -----------------------------------------------------------

test('periodReturn: 30-day return on linear series', () => {
  const prices = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    close: 100 + i,
  }));
  const r = periodReturn(prices, 30);
  // Last close = 159, 30d ago close = 129 → log(159/129)
  assert.ok(r != null && Math.abs((r as number) - Math.log(159 / 129)) < 1e-9);
});

test('periodReturn: null when no prior data', () => {
  const prices = [{ date: '2026-05-15', close: 100 }];
  assert.equal(periodReturn(prices, 30), null);
});

// --- returnSinceDate --------------------------------------------------------

test('returnSinceDate: anchors to first row at-or-after the given date', () => {
  const prices = [
    { date: '2026-01-01', close: 100 },
    { date: '2026-04-01', close: 120 },
    { date: '2026-05-15', close: 150 },
  ];
  const r = returnSinceDate(prices, '2026-04-01');
  assert.ok(r != null && Math.abs((r as number) - Math.log(150 / 120)) < 1e-9);
});

// --- fiftyTwoWeekRange ------------------------------------------------------

test('fiftyTwoWeekRange: position_pct correct mid-range', () => {
  const prices = Array.from({ length: 365 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    close: 100 + (i % 50), // bounces 100..149
  }));
  // Manually set the last close to mid-range
  prices[prices.length - 1] = { date: prices[prices.length - 1].date, close: 125 };
  const r = fiftyTwoWeekRange(prices);
  assert.ok(r != null);
  assert.equal(r!.high, 149);
  assert.equal(r!.low, 100);
  assert.equal(r!.current, 125);
  // (125 - 100) / (149 - 100) ≈ 0.51
  assert.ok(Math.abs(r!.position_pct - 25 / 49) < 1e-9);
});

test('fiftyTwoWeekRange: null for short series', () => {
  const prices = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    close: 100 + i,
  }));
  assert.equal(fiftyTwoWeekRange(prices), null);
});
