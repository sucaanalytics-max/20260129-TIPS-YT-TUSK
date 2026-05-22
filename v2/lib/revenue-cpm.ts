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
}

const CPM_INR = {
  // ₹ per 1,000 views, Indian music vertical
  owned_longform: { low: 25, mid: 40, high: 60 },
  topic_longform: { low: 25, mid: 40, high: 60 },
  shorts_ugc: { low: 8, mid: 15, high: 25 },
} as const;

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
 * already-catalog-share-attributed view count. The 7d window is used as the
 * stable anchor for quarterly extrapolation (× 13 vs × 90 for daily, which
 * is noisier).
 */
export function estimateTopicRevenue(opts: {
  attributed_1d_views: number;
  attributed_7d_views: number;
}): RevenueEstimate {
  return {
    daily: band(opts.attributed_1d_views, CPM_INR.topic_longform, REVENUE_SHARE.owned),
    weekly: band(opts.attributed_7d_views, CPM_INR.topic_longform, REVENUE_SHARE.owned),
    quarterly: band(opts.attributed_7d_views * 13, CPM_INR.topic_longform, REVENUE_SHARE.owned),
    methodology:
      'India music CPM ₹25–60/1k × label revenue share 55%. Quarterly = 7d × 13.',
  };
}

/**
 * Estimate label revenue from UGC Shorts using catalog audio. Uses the
 * Shorts Creator Fund pool CPM (much lower per view than longform) and the
 * label's pool share (~45%).
 */
export function estimateUgcRevenue(opts: {
  attributed_views_7d: number; // sum of UGC views attributed to this label over a 7d snapshot
}): RevenueEstimate {
  // For Shorts UGC we don't have stable daily; treat the 7d window as the
  // anchor and back-derive daily as / 7.
  const daily_proxy = opts.attributed_views_7d / 7;
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
