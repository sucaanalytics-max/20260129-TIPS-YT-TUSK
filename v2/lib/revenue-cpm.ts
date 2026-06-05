/**
 * Revenue-from-views estimator for Indian music YouTube.
 *
 * IMPORTANT — these are MODELLED estimates, not actual revenue numbers.
 * Used to translate the attributed-view signals into IR-relevant rupee
 * ranges so an analyst can gut-check "is this 5% or 25% of quarterly
 * revenue?" without waiting for the next quarterly filing. Always
 * surfaced as a LOW–HIGH band, never as a point estimate.
 *
 * CPM ranges below reflect public benchmarks for Indian music vertical
 * 2025-2026:
 *   - Longform music videos on owned channels: ₹25-60 per 1000 views
 *     (varies by ad density, country mix of viewers, sponsor presence).
 *     Source basis: industry interviews + reverse-engineered from Saregama
 *     and TIPS published revenue lines.
 *   - Topic / OAC channels: same CPM band as owned (label earns ad share
 *     identically).
 *   - Shorts UGC pool: ₹8-25 per 1000 views — Shorts Creator Fund pays
 *     significantly less per view than longform mid-roll/pre-roll ads.
 *
 * Revenue share = label's net cut after YouTube's platform fee and (for
 * UGC) the creator's share:
 *   - Owned / Topic: ~55% net (YT keeps 45% on direct ad revenue)
 *   - Content ID claim on UGC: ~55% net of the UGC's ad revenue
 *   - Shorts sound-system pool: ~45% net (label competes with creator and
 *     other rights-holders in the Shorts pool)
 *
 * These constants are intentionally conservative. Adjust as the labels'
 * actual segment-revenue disclosures land.
 */

export interface RevenueCpmBand {
  low_inr: number;
  mid_inr: number;
  high_inr: number;
}

export interface RevenueEstimate {
  daily: RevenueCpmBand;
  weekly: RevenueCpmBand;
  quarterly: RevenueCpmBand; // run-rate: weekly × 13
  methodology: string;
  // Model confidence grade. Derived from data maturity + sample coverage.
  // 'A' = ≥6 months data + ≥50% catalog match + active backtest calibration
  // 'B' = ≥1 month data, methodology stable, catalog match ≥30%
  // 'C' = ≥7d data, methodology unblocked
  // 'D' = ≤7d data, preliminary
  // 'F' = no real data, baseline-only / cold-start
  confidence_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  confidence_factors: ConfidenceFactors;
}

export interface ConfidenceFactors {
  data_days: number;            // days of underlying data
  catalog_match_pct: number;    // 0-1 — what fraction of UGC is catalog-resolved
  sample_size: number;          // n of attribution checks (UGC) or channels (Topic)
  backtest_calibration: number | null; // ratio of modelled-mid to actual; null until eval
  notes: string[];              // free-form caveats
}

/**
 * Compute a confidence grade from the underlying factors. Conservative —
 * we'd rather show C than overpromise A. As data accumulates the grade
 * naturally improves without intervention.
 */
export function gradeConfidence(f: ConfidenceFactors): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (f.sample_size === 0 && f.data_days === 0) return 'F';
  if (f.data_days < 7) return 'D';
  if (f.data_days < 30) return 'C';
  if (f.data_days < 180) {
    // B requires methodology stable + catalog match ≥ 30%
    if (f.catalog_match_pct >= 0.3 && f.sample_size >= 30) return 'B';
    return 'C';
  }
  // ≥180 days
  if (f.backtest_calibration != null && f.catalog_match_pct >= 0.5) return 'A';
  return 'B';
}

const CPM_INR = {
  // ₹ per 1,000 views, Indian music vertical
  owned_longform: { low: 25, mid: 40, high: 60 },
  topic_longform: { low: 25, mid: 40, high: 60 },
  shorts_ugc: { low: 8, mid: 15, high: 25 },
} as const;

/**
 * Per-language CPM multipliers, applied on top of the base CPM_INR band.
 * Captures the well-known dispersion in ad-rate across Indian content
 * languages:
 *   - Hindi / Bollywood: highest audience, strongest brand demand,
 *     ~1.0× baseline (the baseline is calibrated to Hindi)
 *   - Punjabi: high diaspora viewership, premium CPM ~1.2-1.4×
 *   - English (rare for these labels): premium diaspora CPM ~1.5-2×
 *   - Bhojpuri / regional Indian languages: lower domestic CPM ~0.6-0.8×
 *   - Bengali / Marathi / Tamil / Telugu / Malayalam / Punjabi-folk:
 *     ~0.7-0.9× depending on advertiser depth
 *
 * These multipliers refine the previous one-CPM-fits-all model. Apply
 * via cpmMultiplierForLanguage() before passing into band().
 */
const LANGUAGE_CPM_MULTIPLIER: Record<string, number> = {
  // 1.0 baseline (Hindi calibrated)
  hi: 1.0,
  hin: 1.0,
  // Diaspora-premium languages
  pa: 1.3,
  pan: 1.3,
  en: 1.7,
  // Regional Indian languages (lower domestic CPM)
  bh: 0.7,
  bho: 0.7,
  bn: 0.85,
  ben: 0.85,
  mr: 0.85,
  mar: 0.85,
  ta: 0.9,
  tam: 0.9,
  te: 0.85,
  tel: 0.85,
  ml: 0.85,
  mal: 0.85,
  gu: 0.95,
  guj: 0.95,
  // Devotional / instrumental — lower
  sa: 0.8, // Sanskrit (devotional)
};

/**
 * Resolve a multiplier for an arbitrary language tag. Defaults to 1.0
 * (Hindi baseline) when the language is unknown.
 */
export function cpmMultiplierForLanguage(language: string | null | undefined): number {
  if (!language) return 1.0;
  const key = language.toLowerCase().trim();
  return LANGUAGE_CPM_MULTIPLIER[key] ?? 1.0;
}

const REVENUE_SHARE = {
  owned: 0.55,
  content_id_claim: 0.55,
  shorts_sound_pool: 0.45,
} as const;

function band(
  views: number,
  cpm: { low: number; mid: number; high: number },
  share: number,
): RevenueCpmBand {
  return {
    low_inr: Math.round((views / 1000) * cpm.low * share),
    mid_inr: Math.round((views / 1000) * cpm.mid * share),
    high_inr: Math.round((views / 1000) * cpm.high * share),
  };
}

/**
 * Estimate label revenue from Topic / OAC daily views. Caller passes the
 * already-catalog-share-attributed view count. The 7d window is used as
 * the stable anchor for quarterly extrapolation (× 13 vs × 90 for daily,
 * which is noisier).
 *
 * Optional `languageMix` — array of {language, weight} pairs summing to ~1
 * — applies per-language CPM multipliers. Use when the caller knows the
 * approximate language breakdown of the underlying view sources. When
 * omitted, falls back to Hindi-baseline CPM (1.0×).
 */
export function estimateTopicRevenue(opts: {
  attributed_1d_views: number;
  attributed_7d_views: number;
  languageMix?: Array<{ language: string | null; weight: number }>;
  // Confidence inputs (all optional — fallback to baseline grade)
  data_days?: number;
  sample_size?: number;
  catalog_match_pct?: number;
  backtest_calibration?: number | null;
}): RevenueEstimate {
  const blendedMultiplier = blendLanguageMultiplier(opts.languageMix);
  const cpm = scaleCpm(CPM_INR.topic_longform, blendedMultiplier);
  const factors: ConfidenceFactors = {
    data_days: opts.data_days ?? 0,
    sample_size: opts.sample_size ?? 0,
    catalog_match_pct: opts.catalog_match_pct ?? 0,
    backtest_calibration: opts.backtest_calibration ?? null,
    notes: [
      'Modelled from public CPM benchmarks',
      'CMS API access not granted (fallback to proxy)',
      ...(opts.languageMix?.length
        ? [`Language-weighted CPM (${blendedMultiplier.toFixed(2)}×)`]
        : ['No language mix supplied → Hindi baseline']),
    ],
  };
  return {
    daily: band(opts.attributed_1d_views, cpm, REVENUE_SHARE.owned),
    weekly: band(opts.attributed_7d_views, cpm, REVENUE_SHARE.owned),
    quarterly: band(opts.attributed_7d_views * 13, cpm, REVENUE_SHARE.owned),
    methodology:
      `India music CPM ₹${cpm.low.toFixed(0)}–${cpm.high.toFixed(0)}/1k × label share 55%.` +
      (opts.languageMix?.length
        ? ` Blended CPM multiplier ${blendedMultiplier.toFixed(2)}× from language mix.`
        : ' Hindi baseline (no language mix supplied).') +
      ' Quarterly = 7d × 13.',
    confidence_grade: gradeConfidence(factors),
    confidence_factors: factors,
  };
}

/**
 * Estimate label revenue from owned-channel YouTube views. Same CPM band
 * and revenue share as Topic+OAC (label is the direct YT partner →
 * ~55% of ad revenue) but conceptually distinct: this is the
 * first-party content revenue, NOT a catalog royalty leg.
 *
 * Caller passes raw owned-channel daily_views (no catalog_share scaling
 * needed — these views ARE the label's directly).
 */
export function estimateOwnedRevenue(opts: {
  views_1d: number;
  views_7d: number;
  languageMix?: Array<{ language: string | null; weight: number }>;
  data_days?: number;
  sample_size?: number;
  backtest_calibration?: number | null;
}): RevenueEstimate {
  const blendedMultiplier = blendLanguageMultiplier(opts.languageMix);
  const cpm = scaleCpm(CPM_INR.owned_longform, blendedMultiplier);
  const factors: ConfidenceFactors = {
    data_days: opts.data_days ?? 0,
    sample_size: opts.sample_size ?? 0,
    // Owned channels are 100% catalog by construction
    catalog_match_pct: 1.0,
    backtest_calibration: opts.backtest_calibration ?? null,
    notes: [
      'Owned-channel YT ad revenue (Layer 1)',
      'Modelled from public CPM benchmarks',
      ...(opts.languageMix?.length
        ? [`Language-weighted CPM (${blendedMultiplier.toFixed(2)}×)`]
        : ['Hindi baseline (no language mix supplied)']),
    ],
  };
  return {
    daily: band(opts.views_1d, cpm, REVENUE_SHARE.owned),
    weekly: band(opts.views_7d, cpm, REVENUE_SHARE.owned),
    quarterly: band(opts.views_7d * 13, cpm, REVENUE_SHARE.owned),
    methodology:
      `India music CPM ₹${cpm.low.toFixed(0)}–${cpm.high.toFixed(0)}/1k × label share 55% (direct YT partner).` +
      (opts.languageMix?.length
        ? ` Blended CPM multiplier ${blendedMultiplier.toFixed(2)}× from language mix.`
        : ' Hindi baseline.') +
      ' Quarterly = 7d × 13.',
    confidence_grade: gradeConfidence(factors),
    confidence_factors: factors,
  };
}

/**
 * Sum three YT revenue layers into a consolidated headline band.
 * Layer breakdown is preserved so the UI can show the stack composition.
 *
 * Confidence grade for the consolidated band takes the WORST grade
 * across constituents — the total is only as reliable as its weakest
 * input layer.
 */
export function estimateConsolidatedYT(opts: {
  owned: RevenueEstimate;
  topic: RevenueEstimate;
  ugc: RevenueEstimate;
}): {
  total: { daily: RevenueCpmBand; weekly: RevenueCpmBand; quarterly: RevenueCpmBand };
  worst_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  composition: { owned_pct_mid: number; topic_pct_mid: number; ugc_pct_mid: number };
} {
  const total = {
    daily: sumBands(opts.owned.daily, opts.topic.daily, opts.ugc.daily),
    weekly: sumBands(opts.owned.weekly, opts.topic.weekly, opts.ugc.weekly),
    quarterly: sumBands(opts.owned.quarterly, opts.topic.quarterly, opts.ugc.quarterly),
  };
  const grades: Array<'A' | 'B' | 'C' | 'D' | 'F'> = [
    opts.owned.confidence_grade,
    opts.topic.confidence_grade,
    opts.ugc.confidence_grade,
  ];
  const order: Record<'A' | 'B' | 'C' | 'D' | 'F', number> = {
    F: 0, D: 1, C: 2, B: 3, A: 4,
  };
  const worst_grade = grades.reduce((acc, g) => (order[g] < order[acc] ? g : acc), 'A');
  const denom = total.weekly.mid_inr || 1;
  return {
    total,
    worst_grade,
    composition: {
      owned_pct_mid: opts.owned.weekly.mid_inr / denom,
      topic_pct_mid: opts.topic.weekly.mid_inr / denom,
      ugc_pct_mid: opts.ugc.weekly.mid_inr / denom,
    },
  };
}

function sumBands(...bands: RevenueCpmBand[]): RevenueCpmBand {
  return {
    low_inr: bands.reduce((a, b) => a + b.low_inr, 0),
    mid_inr: bands.reduce((a, b) => a + b.mid_inr, 0),
    high_inr: bands.reduce((a, b) => a + b.high_inr, 0),
  };
}

function scaleCpm(
  cpm: { low: number; mid: number; high: number },
  mult: number,
): { low: number; mid: number; high: number } {
  return {
    low: cpm.low * mult,
    mid: cpm.mid * mult,
    high: cpm.high * mult,
  };
}

function blendLanguageMultiplier(
  mix?: Array<{ language: string | null; weight: number }>,
): number {
  if (!mix || mix.length === 0) return 1.0;
  const total = mix.reduce((acc, m) => acc + (m.weight > 0 ? m.weight : 0), 0);
  if (total <= 0) return 1.0;
  let weighted = 0;
  for (const m of mix) {
    if (m.weight <= 0) continue;
    weighted += (m.weight / total) * cpmMultiplierForLanguage(m.language);
  }
  return weighted;
}

/**
 * Estimate label revenue from UGC Shorts using catalog audio. Uses the
 * Shorts Creator Fund pool CPM (much lower per view than longform) and the
 * label's pool share (~45%).
 */
export function estimateUgcRevenue(opts: {
  attributed_views_7d: number;
  data_days?: number;
  sample_size?: number;
  catalog_match_pct?: number;
  backtest_calibration?: number | null;
}): RevenueEstimate {
  // For Shorts UGC we don't have stable daily; treat the 7d window as the
  // anchor and back-derive daily as / 7.
  const daily_proxy = opts.attributed_views_7d / 7;
  const factors: ConfidenceFactors = {
    data_days: opts.data_days ?? 0,
    sample_size: opts.sample_size ?? 0,
    catalog_match_pct: opts.catalog_match_pct ?? 0,
    backtest_calibration: opts.backtest_calibration ?? null,
    notes: [
      'Shorts pool revenue is pool-shared (not per-view direct)',
      'View counts approximate (parsed from accessibility text)',
      'CMS API access not granted (fallback to proxy)',
    ],
  };
  return {
    daily: band(daily_proxy, CPM_INR.shorts_ugc, REVENUE_SHARE.shorts_sound_pool),
    weekly: band(opts.attributed_views_7d, CPM_INR.shorts_ugc, REVENUE_SHARE.shorts_sound_pool),
    quarterly: band(
      opts.attributed_views_7d * 13,
      CPM_INR.shorts_ugc,
      REVENUE_SHARE.shorts_sound_pool,
    ),
    methodology:
      'Shorts Creator Fund pool ₹8–25/1k × label pool share 45%. Quarterly = 7d × 13.',
    confidence_grade: gradeConfidence(factors),
    confidence_factors: factors,
  };
}

/**
 * Format an INR amount with Indian short-scale (lakh / crore) suffixes.
 * Used for compact display in dashboard tiles.
 *
 *   125_000_000 → "₹12.5cr"
 *      450_000 → "₹4.5L"
 *        2_500 → "₹2,500"
 */
export function fmtInr(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(2)}cr`;
  if (abs >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(amount / 1_000).toFixed(0)}k`;
  return `₹${amount.toLocaleString('en-IN')}`;
}
