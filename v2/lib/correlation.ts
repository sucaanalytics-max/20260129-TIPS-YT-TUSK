/**
 * Correlation primitives for the attention-vs-price panels.
 *
 * Two deliberate choices, both of which change the answer:
 *
 *   1. Correlate against LOG RETURNS, never the price level. Two trending
 *      series correlate with almost anything; that spurious result is the most
 *      common way this analysis is got wrong.
 *   2. Report `n` and expose `criticalR` so a caller can draw the significance
 *      threshold. On this dataset (n ≈ 77) it is 0.2242, and almost nothing
 *      clears it — which is the finding, not a failure to find one.
 */

export interface Dated {
  date: string;
  value: number | null;
}

export interface LagResult {
  lag: number;
  r: number | null;
  n: number;
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
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
  if (dx === 0 || dy === 0) return null; // no variance — correlation undefined
  return num / Math.sqrt(dx * dy);
}

/**
 * ln(p_t / p_{t-1}), INDEX-ALIGNED: the output is the same length as the input,
 * with null wherever a return is uncomputable. Deliberately different from
 * risk.logReturns, which compacts gaps away — that is right for volatility, but
 * it destroys the date alignment lag correlation depends on. Do not merge them.
 */
export function alignedLogReturns(prices: Array<number | null>): Array<number | null> {
  return prices.map((p, i) => {
    if (i === 0) return null;
    const prev = prices[i - 1];
    if (p == null || prev == null || p <= 0 || prev <= 0) return null;
    return Math.log(p / prev);
  });
}

const shift = (date: string, days: number): string =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

/** Correlate metric[t] against ret[t + lag]. Positive lag = metric leads. */
export function lagCorrelate(metric: Dated[], ret: Dated[], lags: number[]): LagResult[] {
  const retBy = new Map(ret.filter((r) => r.value != null).map((r) => [r.date, r.value as number]));
  return lags.map((lag) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const m of metric) {
      if (m.value == null) continue;
      const y = retBy.get(shift(m.date, lag));
      if (y == null) continue;
      xs.push(m.value);
      ys.push(y);
    }
    return { lag, r: xs.length >= 3 ? pearson(xs, ys) : null, n: xs.length };
  });
}

// --- significance ------------------------------------------------------------

function gammaln(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-tailed p for a correlation of |r| on n pairs. */
export function pValue(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return 1;
  const t = Math.abs(r) * Math.sqrt(df / (1 - r * r));
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Smallest |r| that reaches significance at `alpha` for n pairs. */
export function criticalR(n: number, alpha = 0.05): number {
  let lo = 0;
  let hi = 0.999;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pValue(mid, n) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
