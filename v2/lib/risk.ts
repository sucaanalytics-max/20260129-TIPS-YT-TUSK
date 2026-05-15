/**
 * Pure risk-and-return calculations used by the Stock page.
 *
 * No I/O. Inputs are arrays of numbers (returns or prices). Outputs are
 * plain primitives or small objects. Trading-day conventions:
 *   - 252 trading days per year for annualization.
 *   - Returns are log returns unless documented otherwise.
 *
 * All functions handle empty / undersized inputs by returning null rather
 * than NaN, so the UI can render '—' instead of breaking.
 */

const TRADING_DAYS = 252;

/** Sample mean. Returns 0 for empty arrays (caller decides what that means). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (Bessel-corrected). Returns 0 if n<2. */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1));
}

/** Sample covariance. Returns 0 if either array has <2 elements or lengths differ. */
function covariance(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) acc += (xs[i] - mx) * (ys[i] - my);
  return acc / (xs.length - 1);
}

/** Sample variance. Returns 0 if n<2. */
function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  return stddev(xs) ** 2;
}

/**
 * Convert a series of prices (chronological, oldest→newest) into log returns.
 * Skips null values and break-on-zero — typical for adjusted-close inputs.
 * Returns an array of length (prices.length - 1) when all valid.
 */
export function logReturns(prices: Array<number | null>): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1];
    const b = prices[i];
    if (a == null || b == null || a <= 0 || b <= 0) continue;
    out.push(Math.log(b) - Math.log(a));
  }
  return out;
}

/**
 * Annualized realized volatility in decimal form (0.18 = 18%).
 * Returns null if fewer than 5 valid returns — too few to be meaningful.
 */
export function annualizedVolatility(returns: number[]): number | null {
  if (returns.length < 5) return null;
  return stddev(returns) * Math.sqrt(TRADING_DAYS);
}

/**
 * Max peak-to-trough drawdown over a series of prices. Returns:
 *   drawdown_pct  — fraction (negative number; -0.32 = 32% drawdown)
 *   peak_idx      — index of the peak before the drawdown
 *   trough_idx    — index of the trough at the end of the drawdown
 * Returns null if prices.length < 2 or all values are null.
 */
export function maxDrawdown(
  prices: Array<number | null>,
): { drawdown_pct: number; peak_idx: number; trough_idx: number } | null {
  const valid = prices
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null && x.p > 0);
  if (valid.length < 2) return null;

  let peak = valid[0].p;
  let peakIdx = valid[0].i;
  let worst = 0;
  let worstPeakIdx = valid[0].i;
  let worstTroughIdx = valid[0].i;

  for (const { p, i } of valid) {
    if (p > peak) {
      peak = p;
      peakIdx = i;
    }
    const dd = p / peak - 1;
    if (dd < worst) {
      worst = dd;
      worstPeakIdx = peakIdx;
      worstTroughIdx = i;
    }
  }
  return { drawdown_pct: worst, peak_idx: worstPeakIdx, trough_idx: worstTroughIdx };
}

/**
 * CAPM-style beta of a stock vs an index. Both inputs are aligned log-return
 * arrays of equal length. Returns null if undersized or index has zero
 * variance.
 */
export function beta(stockReturns: number[], indexReturns: number[]): number | null {
  if (stockReturns.length !== indexReturns.length) return null;
  if (stockReturns.length < 30) return null;
  const indexVar = variance(indexReturns);
  if (indexVar === 0) return null;
  return covariance(stockReturns, indexReturns) / indexVar;
}

/**
 * Cumulative relative-performance line: at each step, the cumulative log
 * return of the stock minus the cumulative log return of the index, rebased
 * to start at 0. Returns one point per pair of aligned, non-null observations.
 */
export function cumulativeRelativePerformance(
  stock: Array<{ date: string; close: number | null }>,
  index: Array<{ date: string; close: number | null }>,
): Array<{ date: string; rel: number }> {
  const idxMap = new Map(
    index.filter((r) => r.close != null && r.close > 0).map((r) => [r.date, r.close as number]),
  );
  const pairs = stock
    .filter((r) => r.close != null && r.close > 0 && idxMap.has(r.date))
    .map((r) => ({ date: r.date, stock: r.close as number, index: idxMap.get(r.date)! }));
  if (pairs.length < 2) return [];
  const stockBase = pairs[0].stock;
  const indexBase = pairs[0].index;
  return pairs.map((p) => ({
    date: p.date,
    rel: (Math.log(p.stock) - Math.log(stockBase)) - (Math.log(p.index) - Math.log(indexBase)),
  }));
}

/**
 * Period-anchored return between the last close and the close N trading days
 * (or calendar days) prior. Caller decides what N means (1d, 5d, 30d etc.).
 * Returns null if either endpoint is unavailable.
 *
 * Inputs must be sorted ascending by date.
 */
export function periodReturn(
  prices: Array<{ date: string; close: number | null }>,
  daysBack: number,
): number | null {
  if (prices.length === 0) return null;
  const last = prices[prices.length - 1];
  if (last.close == null || last.close <= 0) return null;
  const target = new Date(last.date + 'T00:00:00Z').getTime() - daysBack * 86_400_000;
  // Find the closest row at-or-before `target`.
  let pick: { date: string; close: number | null } | null = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    const t = new Date(prices[i].date + 'T00:00:00Z').getTime();
    if (t <= target) {
      pick = prices[i];
      break;
    }
  }
  if (!pick || pick.close == null || pick.close <= 0) return null;
  return Math.log(last.close) - Math.log(pick.close);
}

/**
 * Return from `from` date (inclusive) to the latest close. Used for YTD /
 * fiscal-period returns where the anchor date is calendar-driven rather than
 * trailing-N-days.
 */
export function returnSinceDate(
  prices: Array<{ date: string; close: number | null }>,
  from: string,
): number | null {
  if (prices.length === 0) return null;
  const last = prices[prices.length - 1];
  if (last.close == null || last.close <= 0) return null;
  const start = prices.find((p) => p.date >= from && p.close != null && p.close > 0);
  if (!start || start.close == null) return null;
  return Math.log(last.close) - Math.log(start.close as number);
}

/**
 * 52-week high/low/current position for a price series. Returns null if
 * fewer than 60 days of valid data.
 */
export function fiftyTwoWeekRange(
  prices: Array<{ date: string; close: number | null }>,
): { high: number; low: number; current: number; position_pct: number } | null {
  const last = prices[prices.length - 1];
  if (!last || last.close == null || last.close <= 0) return null;
  const cutoff = new Date(last.date + 'T00:00:00Z').getTime() - 365 * 86_400_000;
  const window = prices.filter(
    (p) =>
      p.close != null &&
      p.close > 0 &&
      new Date(p.date + 'T00:00:00Z').getTime() >= cutoff,
  );
  if (window.length < 60) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (const p of window) {
    const c = p.close as number;
    if (c > hi) hi = c;
    if (c < lo) lo = c;
  }
  const range = hi - lo;
  const position_pct = range > 0 ? (last.close - lo) / range : 0.5;
  return { high: hi, low: lo, current: last.close, position_pct };
}
