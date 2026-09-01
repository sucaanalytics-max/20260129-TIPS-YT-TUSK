import { lagCorrelate, pValue, criticalR, type Dated, type LagResult } from './correlation';
import { benjaminiHochberg } from './fdr';
import type { ExplorerMetric } from './metrics';

/**
 * Does catalogue reach relate to the share price — and how much of any apparent
 * relationship is just the size of the search?
 *
 * Three choices separate this from a naive scan.
 *
 * 1. EVERY PAIR IS TESTED, INCLUDING THE ONES THAT SHOULD NOT WORK. Each
 *    company's reach is correlated against BOTH share prices. The same-company
 *    cell is the claim; the cross-company cell is the control. If Tips' views
 *    track Saregama's price about as well as they track Tips' own, the
 *    relationship is a market factor rather than anything about the catalogue —
 *    and that is only visible if the control is computed and shown.
 *
 * 2. THE WHOLE GRID IS FDR-CORRECTED TOGETHER. Three metrics, two companies,
 *    two price series and fifteen lags is 180 tests; about nine clear a nominal
 *    5% threshold by chance. Correcting per-cell would miss that, so the
 *    correction spans every test in the matrix at once.
 *
 * 3. SIGNIFICANCE USES AN EFFECTIVE SAMPLE SIZE, NOT n. Daily views is heavily
 *    autocorrelated (a weekly cycle and a growth trend), and treating 300
 *    autocorrelated days as 300 independent observations would over-reject.
 *
 * On that last point — an earlier draft of this module detrended the metric
 * against its own trailing seven-day mean to kill the weekly cycle. That was
 * wrong twice over. Subtracting a CAUSAL moving average is a filter with a
 * phase response, so it shifts the apparent peak lag: it corrupts the one
 * number a lead-lag study exists to produce. And it was unnecessary, because
 * Bartlett's formula gives the variance inflation as
 *
 *     Var(r) ~ (1/n) * (1 + 2 * SUM_k rho_x(k) * rho_y(k))
 *
 * which depends on the PRODUCT of the two autocorrelations. Share-price log
 * returns are close to white, so rho_y(k) ~ 0 and an autocorrelated metric
 * inflates almost nothing. The adjustment is still computed rather than assumed
 * — if returns ever turn out to carry structure, this shrinks n accordingly
 * instead of silently over-reporting significance.
 */

export interface MatrixInput {
  /** Daily metric series per company. Values are flows, not cumulative levels. */
  series: Array<{ company: string; metric: ExplorerMetric; points: Dated[] }>;
  /** Aligned log returns per price symbol. */
  returns: Array<{ symbol: string; points: Dated[] }>;
  lags: number[];
  alpha?: number;
  /** How many autocorrelation lags enter the Bartlett sum. */
  bartlettLags?: number;
}

export interface MatrixCell {
  metric: ExplorerMetric;
  /** Company whose reach this is. */
  source: string;
  /** Company whose share price it is tested against. */
  priceSymbol: string;
  /** The claim (true) or the control (false). */
  sameCompany: boolean;
  lags: LagResult[];
  /** Largest |r| across lags, or null when nothing was computable. */
  best: { lag: number; r: number } | null;
  /** Paired observations at the best lag. */
  n: number;
  /** n after the Bartlett autocorrelation adjustment — what significance uses. */
  nEffective: number;
  /** |r| needed for a nominal alpha at nEffective, before any correction. */
  critical: number | null;
  /** Uncorrected two-tailed p for `best`, on nEffective. */
  p: number | null;
  /** BH-adjusted across the WHOLE matrix. */
  q: number | null;
  /** q <= alpha. The only claim this module will make. */
  significant: boolean;
}

export interface MatrixResult {
  cells: MatrixCell[];
  testsRun: number;
  /** Tests expected to clear a nominal threshold by chance alone. */
  expectedByChance: number;
  /** Cells clearing the nominal threshold, before correction. */
  nominallySignificant: number;
  /** Cells surviving FDR. */
  survivingFdr: number;
  /** Lags scanned per cell — the multiplicity q does NOT capture. */
  lagsScanned: number;
  alpha: number;
}

/** Sample autocorrelation of a series at lag k, ignoring holes. */
export function autocorrelation(values: Array<number | null>, k: number): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = k; i < values.length; i++) {
    const a = values[i - k];
    const b = values[i];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    xs.push(a);
    ys.push(b);
  }
  if (xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Bartlett's effective sample size for the correlation of two series.
 *
 * Clamped to [3, n]: the correction can only ever REDUCE the evidence, never
 * manufacture more of it than was observed, and a degenerate sum must not drive
 * n below what p-value machinery can accept.
 */
export function effectiveSampleSize(
  xs: Array<number | null>,
  ys: Array<number | null>,
  n: number,
  maxLag = 10,
): number {
  if (n < 4) return n;
  let sum = 0;
  for (let k = 1; k <= maxLag; k++) {
    const rx = autocorrelation(xs, k);
    const ry = autocorrelation(ys, k);
    if (rx == null || ry == null) continue;
    sum += rx * ry;
  }
  const inflation = 1 + 2 * sum;
  if (!Number.isFinite(inflation) || inflation <= 0) return n;
  return Math.max(3, Math.min(n, Math.floor(n / inflation)));
}

export function buildCorrelationMatrix(input: MatrixInput): MatrixResult {
  const alpha = input.alpha ?? 0.05;
  const bartlettLags = input.bartlettLags ?? 10;

  /*
   * Every cell x lag is a test, and ALL of them enter one correction.
   *
   * An earlier draft corrected only each cell's best lag. That silently
   * discarded the largest source of multiplicity in the whole design: the best
   * lag is already the maximum of fifteen, so its p-value is not uniform under
   * the null and treating it as a single test is exactly how a lag scan
   * manufactures a finding. On a grid of pure noise that draft reported
   * survivors. Correcting across all 180 tests is what makes an empty grid come
   * back empty.
   */
  interface Test {
    cellIndex: number;
    lag: number;
    r: number;
    n: number;
    nEff: number;
    p: number;
  }

  const shells: Array<Omit<MatrixCell, 'best' | 'n' | 'nEffective' | 'critical' | 'p' | 'q' | 'significant'>> = [];
  const tests: Test[] = [];

  for (const s2 of input.series) {
    for (const ret of input.returns) {
      const lags = lagCorrelate(s2.points, ret.points, input.lags);
      const cellIndex = shells.length;
      shells.push({
        metric: s2.metric,
        source: s2.company,
        priceSymbol: ret.symbol,
        sameCompany: s2.company === ret.symbol,
        lags,
      });

      for (const l of lags) {
        // n < 4 is not a testable correlation. Surfacing an r from three points
        // would colour a matrix cell with a number nothing can support.
        if (l.r == null || l.n < 4) continue;
        const nEff = effectiveSampleSize(
          s2.points.map((p2) => p2.value),
          ret.points.map((p2) => p2.value),
          l.n,
          bartlettLags,
        );
        if (nEff < 4) continue;
        tests.push({ cellIndex, lag: l.lag, r: l.r, n: l.n, nEff, p: pValue(l.r, nEff) });
      }
    }
  }

  const adjusted = benjaminiHochberg(tests, (t) => t.p, alpha);

  // Per cell, the strongest lag by |r| — and the q that lag earned under the
  // correction over the entire grid.
  const bestByCell = new Map<number, { test: Test; q: number; significant: boolean }>();
  adjusted.forEach((a, i) => {
    if (a == null) return;
    const t = tests[i];
    const cur = bestByCell.get(t.cellIndex);
    if (cur == null || Math.abs(t.r) > Math.abs(cur.test.r)) {
      bestByCell.set(t.cellIndex, { test: t, q: a.q, significant: a.significant });
    }
  });

  const cells: MatrixCell[] = shells.map((shell, i) => {
    const b = bestByCell.get(i);
    if (b == null) {
      return {
        ...shell,
        best: null,
        n: 0,
        nEffective: 0,
        critical: null,
        p: null,
        q: null,
        significant: false,
      };
    }
    return {
      ...shell,
      best: { lag: b.test.lag, r: b.test.r },
      n: b.test.n,
      nEffective: b.test.nEff,
      critical: criticalR(b.test.nEff, alpha),
      p: b.test.p,
      q: b.q,
      significant: b.significant,
    };
  });

  // Only tests that actually entered the correction count toward the
  // multiplicity a reader is asked to weigh.
  const testsRun = adjusted.filter((a) => a != null).length;

  return {
    cells,
    testsRun,
    expectedByChance: testsRun * alpha,
    nominallySignificant: cells.filter(
      (c) => c.critical != null && c.best != null && Math.abs(c.best.r) >= c.critical,
    ).length,
    survivingFdr: cells.filter((c) => c.significant).length,
    lagsScanned: input.lags.length,
    alpha,
  };
}
