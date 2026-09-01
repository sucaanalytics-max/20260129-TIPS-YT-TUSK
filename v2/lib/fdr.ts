/**
 * Benjamini–Hochberg false-discovery-rate control.
 *
 * Why this is not optional here. The correlation matrix tests three metrics
 * against two price series for two companies across fifteen lags — 180 tests.
 * At a nominal 5% threshold roughly nine of them clear by chance alone, so an
 * uncorrected grid is guaranteed to show "findings" and none of them mean
 * anything. Reporting a raw p-value from a scan is how a null result gets
 * published as a signal.
 *
 * BH controls the expected PROPORTION of false positives among the rejected
 * tests, which is the right question for a screen: "of the cells I am about to
 * take seriously, roughly how many are noise?" It is less conservative than
 * Bonferroni, which controls the probability of even one false positive and
 * would leave this grid permanently empty.
 */

export interface FdrResult<T> {
  item: T;
  p: number;
  /** BH-adjusted p (a q-value). Monotone non-decreasing in p. */
  q: number;
  /** q <= alpha. */
  significant: boolean;
}

/**
 * Adjust a set of p-values, returning them in the INPUT order.
 *
 * Items whose p is null or non-finite are not tests — they had too little data
 * to compute — and are excluded from the correction entirely rather than being
 * counted as m. Including them would inflate m and make every real test harder
 * to clear, which is a silent penalty for missing data.
 */
export function benjaminiHochberg<T>(
  items: T[],
  pOf: (item: T) => number | null,
  alpha = 0.05,
): Array<FdrResult<T> | null> {
  const testable: Array<{ index: number; p: number }> = [];
  items.forEach((item, index) => {
    const p = pOf(item);
    if (p == null || !Number.isFinite(p) || p < 0 || p > 1) return;
    testable.push({ index, p });
  });

  const m = testable.length;
  const out: Array<FdrResult<T> | null> = items.map(() => null);
  if (m === 0) return out;

  const asc = [...testable].sort((a, b) => a.p - b.p);

  /*
   * Walk from the largest p down, carrying the running minimum. This is the
   * step-up enforcement: without it a q can come out smaller than the q of a
   * more significant test, which would let a weaker result outrank a stronger
   * one purely from the m/i factor.
   */
  const q = new Array<number>(m);
  let running = 1;
  for (let i = m - 1; i >= 0; i--) {
    const raw = (asc[i].p * m) / (i + 1);
    running = Math.min(running, raw);
    q[i] = running;
  }

  asc.forEach((t, i) => {
    out[t.index] = {
      item: items[t.index],
      p: t.p,
      q: q[i],
      significant: q[i] <= alpha,
    };
  });
  return out;
}

/**
 * How many of a set of tests would clear a NOMINAL threshold by chance alone.
 *
 * Shown beside the count that actually cleared, so a reader can see whether the
 * result is distinguishable from the scan itself.
 */
export function expectedFalsePositives(nTests: number, alpha = 0.05): number {
  return nTests * alpha;
}
