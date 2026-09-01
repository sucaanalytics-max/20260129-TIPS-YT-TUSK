/**
 * Run: npx tsx --test lib/correlation-matrix.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autocorrelation,
  buildCorrelationMatrix,
  effectiveSampleSize,
} from './correlation-matrix';
import type { Dated } from './correlation';

const DAY = 86_400_000;
const series = (values: Array<number | null>, start = '2026-01-01'): Dated[] =>
  values.map((value, i) => ({
    date: new Date(Date.parse(`${start}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10),
    value,
  }));

/** Deterministic PRNG so "noise" tests are reproducible. */
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/* ---- autocorrelation ------------------------------------------------------ */

test('autocorrelation: a 7-day cycle is near +1 at lag 7', () => {
  const cycle = [10, 40, 20, 60, 30, 50, 15];
  const vals = Array.from({ length: 70 }, (_, i) => cycle[i % 7]);
  assert.ok((autocorrelation(vals, 7) ?? 0) > 0.99);
});

test('autocorrelation: a 7-day cycle is negative or weak at lag 3', () => {
  const cycle = [10, 40, 20, 60, 30, 50, 15];
  const vals = Array.from({ length: 70 }, (_, i) => cycle[i % 7]);
  assert.ok((autocorrelation(vals, 3) ?? 1) < 0.5);
});

test('autocorrelation: a flat series has no variance and returns null', () => {
  assert.equal(autocorrelation(Array.from({ length: 30 }, () => 5), 1), null);
});

test('autocorrelation: too few pairs returns null rather than a wild estimate', () => {
  assert.equal(autocorrelation([1, 2, 3], 2), null);
});

/* ---- effective sample size ------------------------------------------------ */

test('effectiveSampleSize: white against white leaves n essentially intact', () => {
  const rand = prng(7);
  const xs = Array.from({ length: 300 }, () => rand());
  const ys = Array.from({ length: 300 }, () => rand());
  const nEff = effectiveSampleSize(xs, ys, 300);
  assert.ok(nEff > 200, `expected n to survive, got ${nEff}`);
  assert.ok(nEff <= 300);
});

test('effectiveSampleSize: an autocorrelated metric against WHITE returns barely shrinks n', () => {
  // The load-bearing property. Bartlett depends on the PRODUCT of the two
  // autocorrelations, so a strong weekly cycle in views does not inflate the
  // variance when price returns are white. This is why the metric is no longer
  // detrended — detrending would have corrupted the lag to fix a non-problem.
  const cycle = [10, 40, 20, 60, 30, 50, 15];
  const xs = Array.from({ length: 300 }, (_, i) => cycle[i % 7]);
  const rand = prng(11);
  const ys = Array.from({ length: 300 }, () => rand());
  const nEff = effectiveSampleSize(xs, ys, 300);
  assert.ok(nEff > 200, `autocorrelated-vs-white should keep most of n, got ${nEff}`);
});

test('effectiveSampleSize: when BOTH series share the cycle, n collapses', () => {
  // And when the product is genuinely large, the correction bites hard.
  const cycle = [10, 40, 20, 60, 30, 50, 15];
  const xs = Array.from({ length: 300 }, (_, i) => cycle[i % 7]);
  const ys = Array.from({ length: 300 }, (_, i) => cycle[i % 7]);
  const nEff = effectiveSampleSize(xs, ys, 300);
  assert.ok(nEff < 300, `expected shrinkage, got ${nEff}`);
});

test('effectiveSampleSize: never exceeds n and never drops below 3', () => {
  // The correction may only ever remove evidence, never invent it.
  const cycle = [1, -1];
  const xs = Array.from({ length: 60 }, (_, i) => cycle[i % 2]);
  const ys = Array.from({ length: 60 }, (_, i) => cycle[i % 2]);
  const nEff = effectiveSampleSize(xs, ys, 60);
  assert.ok(nEff >= 3 && nEff <= 60, `out of bounds: ${nEff}`);
});

/* ---- the matrix ----------------------------------------------------------- */

test('matrix: builds a cell for every metric x company x price pair', () => {
  const pts = series(Array.from({ length: 40 }, (_, i) => 100 + i));
  const res = buildCorrelationMatrix({
    series: [
      { company: 'A', metric: 'views', points: pts },
      { company: 'B', metric: 'views', points: pts },
    ],
    returns: [
      { symbol: 'A', points: series(Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.01 : -0.01))) },
      { symbol: 'B', points: series(Array.from({ length: 40 }, (_, i) => (i % 3 ? 0.01 : -0.02))) },
    ],
    lags: [0],
  });
  assert.equal(res.cells.length, 4);
  assert.equal(res.cells.filter((c) => c.sameCompany).length, 2);
  assert.equal(res.cells.filter((c) => !c.sameCompany).length, 2);
});

test('matrix: recovers a planted lead at the right lag and sign', () => {
  // The return is white; the metric at t carries the return at t+2 plus noise,
  // so views LEAD price by two days. The convention is "positive lag = metric
  // leads", so the peak must sit at +2.
  //
  // This is the test that caught the phase shift from detrending with a causal
  // moving average — that draft moved the peak off +2, corrupting the one
  // number a lead-lag study exists to produce.
  const rand = prng(4242);
  const n = 200;
  const rets = Array.from({ length: n }, () => rand() * 0.04 - 0.02);
  const views = Array.from({ length: n }, (_, i) =>
    1000 + (i + 2 < n ? rets[i + 2] * 40_000 : 0) + (rand() - 0.5) * 60,
  );
  const res = buildCorrelationMatrix({
    series: [{ company: 'A', metric: 'views', points: series(views) }],
    returns: [{ symbol: 'A', points: series(rets) }],
    lags: [-4, -3, -2, -1, 0, 1, 2, 3, 4],
  });
  const cell = res.cells[0];
  assert.equal(cell.best?.lag, 2, 'peak must sit at +2, the planted lead');
  assert.ok((cell.best?.r ?? 0) > 0.8, `expected a strong positive r, got ${cell.best?.r}`);
  assert.equal(cell.significant, true, 'a real planted signal must survive the correction');
});

test('matrix: when both series are autocorrelated the bar rises', () => {
  // Both sides carry the same weekly cycle plus independent noise, so the
  // relationship is real but the observations are far from independent.
  // Bartlett must shrink n materially, which raises the critical r the cell has
  // to clear. Two hundred days of a repeating pattern is not two hundred
  // independent observations.
  const rand = prng(808);
  const cycle = [10, 40, 20, 60, 30, 50, 15];
  const n = 200;
  const xs = Array.from({ length: n }, (_, i) => cycle[i % 7] + (rand() - 0.5) * 20);
  const ys = Array.from({ length: n }, (_, i) => cycle[i % 7] * 0.0002 + (rand() - 0.5) * 0.004);
  const res = buildCorrelationMatrix({
    series: [{ company: 'A', metric: 'views', points: series(xs) }],
    returns: [{ symbol: 'A', points: series(ys) }],
    lags: [0],
  });
  const cell = res.cells[0];
  assert.ok(cell.best != null, 'the cell should still be testable');
  assert.ok(
    cell.nEffective < cell.n,
    `effective n must shrink: got ${cell.nEffective} of ${cell.n}`,
  );
  // And the shrinkage has teeth — the critical r is above what n alone implies.
  assert.ok(cell.critical != null && cell.critical > 0.14);
});

test('matrix: pure noise across a full grid does not survive the correction', () => {
  // The property that matters most. Twelve pairs scanned across fifteen lags,
  // none of them related — the grid must come back empty. Without the FDR pass
  // this is exactly where a null result gets reported as a finding.
  const rand = prng(12345);
  const n = 150;
  const lags = Array.from({ length: 15 }, (_, i) => i - 7);
  const res = buildCorrelationMatrix({
    series: (['views', 'subscribers', 'releases'] as const).flatMap((metric) =>
      ['A', 'B'].map((company) => ({
        company,
        metric,
        points: series(Array.from({ length: n }, () => rand() * 1000)),
      })),
    ),
    returns: ['A', 'B'].map((symbol) => ({
      symbol,
      points: series(Array.from({ length: n }, () => rand() * 0.04 - 0.02)),
    })),
    lags,
  });
  assert.equal(res.cells.length, 12);
  assert.equal(res.survivingFdr, 0, 'noise must not survive FDR');
  assert.equal(res.lagsScanned, 15);
});

test('matrix: reports the multiplicity so a scan cannot be read as a finding', () => {
  const rand = prng(99);
  const n = 120;
  const res = buildCorrelationMatrix({
    series: [{ company: 'A', metric: 'views', points: series(Array.from({ length: n }, () => rand() * 100)) }],
    returns: [{ symbol: 'A', points: series(Array.from({ length: n }, () => rand() * 0.02)) }],
    lags: [0, 1, 2],
    alpha: 0.05,
  });
  // Every cell x lag is a test, so three lags on one pair is three tests --
  // not one. That distinction is the whole point of the correction.
  assert.equal(res.testsRun, 3);
  assert.equal(Math.round(res.expectedByChance * 1000) / 1000, 0.15);
  assert.equal(res.lagsScanned, 3);
});

test('matrix: too little data yields a null cell, never a fabricated zero', () => {
  const res = buildCorrelationMatrix({
    series: [{ company: 'A', metric: 'views', points: series([1, 2, 3]) }],
    returns: [{ symbol: 'A', points: series([0.01, 0.02, 0.03]) }],
    lags: [0],
  });
  const cell = res.cells[0];
  assert.equal(cell.best, null);
  assert.equal(cell.p, null);
  assert.equal(cell.q, null);
  assert.equal(cell.significant, false);
  assert.equal(res.testsRun, 0);
});

test('matrix: a flat metric is not measurable, not a correlation of zero', () => {
  // pearson returns null with no variance. Surfacing r = 0 would read as
  // "measured, and unrelated" when the truth is "not measurable".
  const res = buildCorrelationMatrix({
    series: [
      { company: 'A', metric: 'releases', points: series(Array.from({ length: 40 }, () => 5)) },
    ],
    returns: [
      { symbol: 'A', points: series(Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.01 : -0.01))) },
    ],
    lags: [0],
  });
  assert.equal(res.cells[0].best, null);
});

test('matrix: the control pair is computed, not assumed absent', () => {
  // A cross-company cell must be a real test with its own n, so a market-wide
  // factor shows up as a control that scores like the claim.
  const rand = prng(5);
  const n = 100;
  const shared = Array.from({ length: n }, () => rand() * 0.03 - 0.015);
  const res = buildCorrelationMatrix({
    series: [{ company: 'A', metric: 'views', points: series(shared.map((v) => v * 1000)) }],
    returns: [
      { symbol: 'A', points: series(shared) },
      { symbol: 'B', points: series(shared) }, // B moves identically to A
    ],
    lags: [0],
  });
  const claim = res.cells.find((c) => c.sameCompany)!;
  const control = res.cells.find((c) => !c.sameCompany)!;
  assert.ok(claim.best != null && control.best != null);
  // Identical price series means the control scores exactly like the claim —
  // which is the signature of a market factor rather than a catalogue effect.
  assert.equal(claim.best!.r.toFixed(6), control.best!.r.toFixed(6));
});
