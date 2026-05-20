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
  // PR 3a additions — purely additive; composeRead's bias scoring still uses the
  // original 6-signal weighting to keep the IR READ stable. These tiles surface
  // alongside as additional context on the SignalGrid.
  peerRankMomentum: SignalCell;
  liveEventDensity: SignalCell;
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

// --- peerRankMomentum -------------------------------------------------------

export interface SBSnapshot {
  asof: string;          // YYYY-MM-DD
  subs_rank: number | null;
}

/**
 * Peer-relative subscriber-rank momentum. Lower rank number = climbing peers.
 * Direction is *inverted* from the raw rank delta: rank dropping (e.g. 31 → 25)
 * is a POSITIVE signal (climbing).
 *
 * Returns value = -(rank_today - rank_30d_ago)  i.e. positive when rank fell.
 * Requires ≥ 4 snapshots in the window; otherwise warming.
 */
export function peerRankMomentum(snapshots: SBSnapshot[]): SignalCell {
  // Sort ascending by asof so latest = last element
  const sorted = [...snapshots]
    .filter((s) => s.subs_rank != null && Number.isFinite(s.subs_rank))
    .sort((a, b) => a.asof.localeCompare(b.asof));
  if (sorted.length < 4) {
    return { value: null, sigma: null, direction: 'flat', significant: false, warming: true };
  }
  const latest = sorted[sorted.length - 1];
  const anchor =
    sorted.find(
      (s) =>
        new Date(latest.asof + 'T00:00:00Z').getTime() -
          new Date(s.asof + 'T00:00:00Z').getTime() >=
        30 * 86_400_000,
    ) ?? sorted[0];
  const delta_inverted = (anchor.subs_rank as number) - (latest.subs_rank as number);

  // Z-score against the distribution of all 30d-prior deltas in the window
  const deltas: number[] = [];
  for (const cur of sorted) {
    const prior = sorted.find(
      (p) =>
        new Date(cur.asof + 'T00:00:00Z').getTime() -
          new Date(p.asof + 'T00:00:00Z').getTime() >=
        30 * 86_400_000,
    );
    if (prior && cur.subs_rank != null && prior.subs_rank != null) {
      deltas.push((prior.subs_rank as number) - (cur.subs_rank as number));
    }
  }
  let sigma: number | null = null;
  if (deltas.length >= 2) {
    const mu = mean(deltas);
    const sd = std(deltas);
    if (sd > 0) sigma = (delta_inverted - mu) / sd;
  }
  let direction: Direction = 'flat';
  if (delta_inverted > 0) direction = 'up';
  else if (delta_inverted < 0) direction = 'down';

  return {
    value: delta_inverted,
    sigma,
    direction,
    significant: Math.abs(delta_inverted) >= 3, // 3+ position shift considered meaningful
    warming: false,
    caveat: 'Lower rank number = better. Value is rank improvement (positive = climbing peers).',
  };
}

// --- liveEventDensity -------------------------------------------------------

export interface LiveEventInput {
  event_date: string;      // YYYY-MM-DD
}

/**
 * Count of live broadcasts / premieres in the trailing window, with z-score
 * against the prior equal-length window. Captures "release activity" beyond
 * what catalogFreshness sees (catalog freshness misses live-only content).
 */
export function liveEventDensity(
  events: LiveEventInput[],
  asOf: Date = new Date(),
  windowDays = 30,
): SignalCell {
  const todayMs = asOf.getTime();
  const winMs = windowDays * 86_400_000;
  const cutoffMs = todayMs - winMs;
  const priorCutoffMs = todayMs - 2 * winMs;

  let cur = 0;
  let prior = 0;
  for (const e of events) {
    const t = new Date(e.event_date + 'T00:00:00Z').getTime();
    if (t >= cutoffMs && t < todayMs) cur += 1;
    else if (t >= priorCutoffMs && t < cutoffMs) prior += 1;
  }

  let direction: Direction = 'flat';
  if (cur > prior * 1.2) direction = 'up';
  else if (cur < prior * 0.8) direction = 'down';

  // z-score against poisson-style baseline (prior count as expected mean)
  let sigma: number | null = null;
  if (prior >= 3) {
    sigma = (cur - prior) / Math.sqrt(prior);
  }

  return {
    value: cur,
    sigma,
    direction,
    significant: sigma != null && Math.abs(sigma) > 1.5,
    warming: cur + prior < 3,
  };
}

// --- fitCatalogDecay --------------------------------------------------------

export interface DecayInput {
  video_age_days: number;  // days since published_at
  daily_views: number;     // observed daily views
}

export interface DecayCurve {
  a: number;             // intercept (estimated initial day-1 views)
  b: number;             // decay exponent (positive = decaying)
  r_squared: number;     // 0..1
  n_observations: number;
  n_videos?: number;     // optional context
}

/**
 * Fit a power-law catalog decay: daily_views(t) = a * (1 + t)^(-b)
 *
 * Linearized: log(views) = log(a) - b * log(1 + t)
 * Solved as ordinary least squares on the log-log pairs.
 *
 * Filters out daily_views <= 0 (log undefined) and any age < 0.
 * Returns null if too few observations to fit.
 */
export function fitCatalogDecay(observations: DecayInput[]): DecayCurve | null {
  const pairs: Array<{ x: number; y: number }> = [];
  for (const o of observations) {
    if (o.video_age_days < 0) continue;
    if (o.daily_views <= 0) continue;
    pairs.push({
      x: Math.log(1 + o.video_age_days),
      y: Math.log(o.daily_views),
    });
  }
  if (pairs.length < 30) return null;

  const n = pairs.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const p of pairs) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // R²
  const mean_y = sy / n;
  let ss_tot = 0;
  let ss_res = 0;
  for (const p of pairs) {
    const yHat = intercept + slope * p.x;
    ss_tot += (p.y - mean_y) ** 2;
    ss_res += (p.y - yHat) ** 2;
  }
  const r_squared = ss_tot > 0 ? 1 - ss_res / ss_tot : 0;

  return {
    a: Math.exp(intercept),
    b: -slope, // slope is typically negative; report b as positive decay rate
    r_squared,
    n_observations: n,
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
