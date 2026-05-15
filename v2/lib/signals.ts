/**
 * Pure signal-computation layer for the IR cockpit.
 *
 * Each function takes pre-fetched series and returns a SignalCell. No I/O.
 * The orchestration (fanning out Supabase fetches) happens in queries.ts.
 *
 * composeRead() takes the full SignalsSnapshot and emits a deterministic
 * one-line READ plus a bias label (POSITIVE / MIXED / NEGATIVE) using a
 * weighted-sum scoring of the six signals. No LLM — explainable and testable.
 */

export type Direction = 'up' | 'down' | 'flat';
export type Bias = 'POSITIVE' | 'MIXED' | 'NEGATIVE';

export interface SignalCell {
  value: number | null;
  sigma?: number | null;
  direction: Direction;
  significant: boolean;
  warming: boolean;
  caveat?: string;
  sparkline?: Array<number | null>;
}

export interface SignalsSnapshot {
  company: string;
  asOf: string | null;
  daysAvailable: number;
  viewMomentum: SignalCell;
  catalogFreshness: SignalCell;
  leadLag: SignalCell & { lagDays: number | null };
  relativeStrength: SignalCell;
  divergence: SignalCell & { active: boolean };
  subscriberDrift: SignalCell;
}

// --- constants ---------------------------------------------------------------

export const WARMUP_DAYS = 30;
const TRAILING_WINDOW = 90;
const Z_DIR = 0.5;
const Z_SIG = 1.5;
const SPARKLINE_LEN = 60;

// --- helpers -----------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}
function directionFromZ(z: number | null): Direction {
  if (z == null || !Number.isFinite(z)) return 'flat';
  if (z > Z_DIR) return 'up';
  if (z < -Z_DIR) return 'down';
  return 'flat';
}

// --- viewMomentum ------------------------------------------------------------

/**
 * Z-score of the trailing 7d average of daily_views against the distribution
 * of trailing-7d averages over the prior TRAILING_WINDOW days. Sparkline is
 * the last 60 days of raw daily_views (chronological).
 *
 * Input must be sorted ascending by date.
 */
export function viewMomentum(
  rows: Array<{ date: string; daily_views: number | null }>,
): SignalCell {
  const series = rows.map((r) => (r.daily_views == null ? null : Number(r.daily_views)));
  const numericCount = series.filter((v): v is number => v != null).length;
  if (numericCount < WARMUP_DAYS) {
    return { value: null, sigma: null, direction: 'flat', significant: false, warming: true };
  }
  const dist: number[] = [];
  for (let i = 6; i < series.length; i++) {
    const window = series.slice(i - 6, i + 1).filter((v): v is number => v != null);
    if (window.length === 7) dist.push(mean(window));
  }
  // Exclude the latest trailing window from the baseline so we measure
  // *deviation*, not "z of the value against itself".
  const baseline = dist.slice(-TRAILING_WINDOW - 1, -1);
  const latest7slice = series.slice(-7).filter((v): v is number => v != null);
  const latest7 = latest7slice.length === 7 ? mean(latest7slice) : null;
  const mu = mean(baseline);
  const sd = std(baseline);
  const z = latest7 != null && sd > 0 ? (latest7 - mu) / sd : null;

  return {
    value: latest7,
    sigma: z,
    direction: directionFromZ(z),
    significant: z != null && Math.abs(z) > Z_SIG,
    warming: false,
    sparkline: series.slice(-SPARKLINE_LEN),
  };
}

// --- catalogFreshness --------------------------------------------------------

export interface VideoFreshnessInput {
  published_at: string;          // ISO date
  views_last_30d: number;        // sum of fct_video_daily.daily_views over last 30 days
}

/**
 * Share of last-30d views coming from videos published in the last 90 days.
 * High → label is actively producing hits, not riding catalog. Strong leading
 * indicator of revenue durability.
 */
export function catalogFreshness(
  videos: VideoFreshnessInput[],
  asOf: Date = new Date(),
): SignalCell {
  if (videos.length === 0) {
    return { value: null, direction: 'flat', significant: false, warming: true };
  }
  const ninetyDaysAgoMs = asOf.getTime() - 90 * 86_400_000;
  let total = 0;
  let fresh = 0;
  for (const v of videos) {
    total += v.views_last_30d;
    const t = new Date(v.published_at).getTime();
    if (Number.isFinite(t) && t >= ninetyDaysAgoMs) fresh += v.views_last_30d;
  }
  if (total === 0) {
    return { value: null, direction: 'flat', significant: false, warming: true };
  }
  const ratio = fresh / total;
  let direction: Direction = 'flat';
  if (ratio > 0.6) direction = 'up';
  else if (ratio < 0.3) direction = 'down';
  return {
    value: ratio,
    direction,
    significant: ratio > 0.6,
    warming: false,
  };
}

// --- leadLag -----------------------------------------------------------------

export interface LeadLagInput {
  lag_days: number;
  pearson_r: number;
  p_value_fdr: number | null;
  is_significant: boolean | null;
}

/**
 * Strongest currently-FDR-significant (lag, r) on views→price. Positive lag
 * means views *lead* price by that many days. Falls back to the strongest
 * raw |r| if no rows are FDR-significant, but flags that on `significant`.
 */
export function leadLagRead(
  rows: LeadLagInput[],
): SignalCell & { lagDays: number | null } {
  if (rows.length === 0) {
    return {
      value: null,
      direction: 'flat',
      significant: false,
      warming: true,
      lagDays: null,
    };
  }
  const sig = rows.filter((r) => r.is_significant === true);
  const pool = sig.length > 0 ? sig : rows;
  const best = pool.reduce(
    (b, r) => (Math.abs(r.pearson_r) > Math.abs(b.pearson_r) ? r : b),
    pool[0],
  );
  let direction: Direction = 'flat';
  if (best.pearson_r > 0.2) direction = 'up';
  else if (best.pearson_r < -0.2) direction = 'down';
  return {
    value: best.pearson_r,
    direction,
    significant: best.is_significant === true,
    warming: false,
    lagDays: best.lag_days,
  };
}

// --- relativeStrength --------------------------------------------------------

/**
 * 30-day log-return on adjusted_close minus 30-day log-return on the index
 * (NIFTY MIDCAP 150 by default). Positive = outperforming benchmark.
 * Rows must be sorted ascending by date.
 */
export function relativeStrength(
  stock: Array<{ date: string; adjusted_close: number | null }>,
  index: Array<{ date: string; close: number | null }>,
  days = 30,
): SignalCell {
  function logRet(
    rows: Array<{ date: string; adjusted_close?: number | null; close?: number | null }>,
    field: 'adjusted_close' | 'close',
  ): number | null {
    const filtered = rows.filter((r) => r[field] != null);
    if (filtered.length < days + 1) return null;
    const last = Number(filtered[filtered.length - 1][field]);
    const first = Number(filtered[filtered.length - 1 - days][field]);
    if (!Number.isFinite(last) || !Number.isFinite(first) || first <= 0 || last <= 0) return null;
    return Math.log(last) - Math.log(first);
  }
  const sRet = logRet(stock, 'adjusted_close');
  const iRet = logRet(index, 'close');
  if (sRet == null || iRet == null) {
    return { value: null, direction: 'flat', significant: false, warming: true };
  }
  const diff = sRet - iRet;
  let direction: Direction = 'flat';
  if (diff > 0.02) direction = 'up';
  else if (diff < -0.02) direction = 'down';
  return {
    value: diff,
    direction,
    significant: Math.abs(diff) > 0.05,
    warming: false,
  };
}

// --- divergence --------------------------------------------------------------

/**
 * Active when sign(view momentum z) ≠ sign(price momentum z) AND both are
 * non-trivial. The `direction` follows the view side — i.e. an active
 * divergence with views ↑ implies a positive setup for the stock (views are
 * usually leading per lead-lag analysis).
 */
export function divergence(
  viewMomentumZ: number | null,
  priceMomentumZ: number | null,
): SignalCell & { active: boolean } {
  if (viewMomentumZ == null || priceMomentumZ == null) {
    return {
      value: null,
      direction: 'flat',
      significant: false,
      warming: true,
      active: false,
    };
  }
  const active =
    Math.sign(viewMomentumZ) !== Math.sign(priceMomentumZ) &&
    Math.abs(viewMomentumZ) > Z_DIR &&
    Math.abs(priceMomentumZ) > Z_DIR;
  return {
    value: viewMomentumZ - priceMomentumZ,
    direction: viewMomentumZ > 0 ? 'up' : viewMomentumZ < 0 ? 'down' : 'flat',
    significant: active,
    warming: false,
    active,
  };
}

// --- subscriberDrift ---------------------------------------------------------

/**
 * Z-score of the latest 7-day Δsubscribers against the trailing distribution.
 * YouTube rounds subscriber counts above 1k, so absolute values are coarse —
 * the trend is what matters. Caveat exposed on the cell.
 */
export function subscriberDrift(
  rows: Array<{ date: string; subscribers: number | null }>,
): SignalCell {
  const subs = rows.map((r) => (r.subscribers == null ? null : Number(r.subscribers)));
  const valid = subs.filter((v): v is number => v != null).length;
  if (valid < WARMUP_DAYS) {
    return {
      value: null,
      direction: 'flat',
      significant: false,
      warming: true,
      caveat: 'YouTube rounds subscriber counts above 1k.',
    };
  }
  const deltas: number[] = [];
  for (let i = 7; i < subs.length; i++) {
    const a = subs[i];
    const b = subs[i - 7];
    if (a != null && b != null) deltas.push(a - b);
  }
  if (deltas.length < 10) {
    return {
      value: null,
      direction: 'flat',
      significant: false,
      warming: true,
      caveat: 'YouTube rounds subscriber counts above 1k.',
    };
  }
  const baseline = deltas.slice(0, -1);
  const latest = deltas[deltas.length - 1];
  const mu = mean(baseline);
  const sd = std(baseline);
  const z = sd > 0 ? (latest - mu) / sd : null;
  return {
    value: latest,
    sigma: z,
    direction: directionFromZ(z),
    significant: z != null && Math.abs(z) > Z_SIG,
    warming: false,
    caveat: 'YouTube rounds subscriber counts above 1k.',
  };
}

// --- composeRead -------------------------------------------------------------

const WEIGHTS = {
  viewMomentum: 2,
  catalogFreshness: 2,
  leadLag: 3,
  relativeStrength: 1,
  divergence: 2,
  subscriberDrift: 1,
} as const;

const POSITIVE_THRESHOLD = 3;
const NEGATIVE_THRESHOLD = -3;

function dirScore(d: Direction): number {
  return d === 'up' ? 1 : d === 'down' ? -1 : 0;
}

export interface Read {
  bias: Bias;
  sentence: string;
  score: number;
}

export function composeRead(snap: SignalsSnapshot): Read {
  let score = 0;

  if (!snap.viewMomentum.warming) {
    score += dirScore(snap.viewMomentum.direction) * WEIGHTS.viewMomentum;
  }
  if (!snap.catalogFreshness.warming) {
    score += dirScore(snap.catalogFreshness.direction) * WEIGHTS.catalogFreshness;
  }
  // Lead-lag contributes only when FDR-significant (cheap signal otherwise).
  if (!snap.leadLag.warming && snap.leadLag.significant) {
    score += dirScore(snap.leadLag.direction) * WEIGHTS.leadLag;
  }
  if (!snap.relativeStrength.warming) {
    score += dirScore(snap.relativeStrength.direction) * WEIGHTS.relativeStrength;
  }
  if (!snap.divergence.warming && snap.divergence.active) {
    score += dirScore(snap.divergence.direction) * WEIGHTS.divergence;
  }
  if (!snap.subscriberDrift.warming) {
    score += dirScore(snap.subscriberDrift.direction) * WEIGHTS.subscriberDrift;
  }

  let bias: Bias;
  if (score >= POSITIVE_THRESHOLD) bias = 'POSITIVE';
  else if (score <= NEGATIVE_THRESHOLD) bias = 'NEGATIVE';
  else bias = 'MIXED';

  const parts: string[] = [];

  if (snap.viewMomentum.warming) {
    parts.push(`Warming up · ${snap.daysAvailable}/${WARMUP_DAYS} days`);
  } else if (snap.viewMomentum.sigma != null) {
    const z = snap.viewMomentum.sigma;
    parts.push(`Views ${z >= 0 ? '+' : ''}${z.toFixed(1)}σ vs 30d`);
  }

  if (
    !snap.leadLag.warming &&
    snap.leadLag.significant &&
    snap.leadLag.lagDays != null &&
    snap.leadLag.value != null
  ) {
    const lag = snap.leadLag.lagDays;
    const lagLabel = lag === 0 ? 'concurrent' : lag > 0 ? `lead ${lag}d` : `lag ${Math.abs(lag)}d`;
    const r = snap.leadLag.value;
    parts.push(`${lagLabel}, r=${r >= 0 ? '+' : ''}${r.toFixed(2)} ✓ FDR`);
  }

  if (!snap.catalogFreshness.warming && snap.catalogFreshness.value != null) {
    parts.push(`catalog ${Math.round(snap.catalogFreshness.value * 100)}% fresh`);
  }

  if (
    !snap.relativeStrength.warming &&
    snap.relativeStrength.value != null &&
    Math.abs(snap.relativeStrength.value) > 0.02
  ) {
    const v = snap.relativeStrength.value;
    parts.push(`${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}% vs index`);
  }

  if (snap.divergence.active) {
    parts.push('view↔price divergence active');
  }

  const sentence = parts.length > 0 ? parts.join('. ') + '.' : 'Insufficient data.';

  return { bias, sentence, score };
}
