/**
 * Pure aggregation helpers for the India demand layer.
 *
 * Deliberately dependency-free and separate from lib/app-intel.ts: that module
 * dynamically imports the optional `google-play-scraper` package, which drags a
 * "module not found" warning — and a pointless dependency edge — into the
 * bundle graph of every Server Component that touches it. queries.ts is
 * imported by the /market page, so the pure half lives here instead. Same split
 * as lib/total-reach.ts and lib/ugc-aggregate.ts.
 */

export interface AppProxyPoint {
  date: string;                 // YYYY-MM-DD
  rating_count: number | null;  // cumulative for this storefront — never decrements
  rating_avg: number | null;
  install_bucket: string | null;
}

export interface AppProxyRollup {
  latest: AppProxyPoint;
  /** Change in cumulative rating count across the trailing window. */
  rating_count_delta: number | null;
  /** Days the delta actually spans (>= windowDays), or null when there is none. */
  delta_span_days: number | null;
  /** Ascending {asof, metric} series shaped for signals.demandMomentum(). */
  history: Array<{ asof: string; metric: number | null }>;
  days_observed: number;
}

const DAY_MS = 86_400_000;
const dayMs = (d: string): number => new Date(d + 'T00:00:00Z').getTime();

/**
 * Collapse one (dsp, store, source) daily series into a latest snapshot plus a
 * trailing-window velocity.
 *
 * The delta anchors on the most recent observation at or before
 * (latest - windowDays) — deliberately NOT on the first row of the series.
 * Anchoring on the first row is wrong in both directions: it mislabels a
 * 180-day delta as a 30-day one whenever the fetch window is wider than the
 * delta window, and it reports a confident "30d" delta for a series only a few
 * days old. When no observation is old enough the delta is null, so callers can
 * render "accumulating" rather than a number that means something else.
 *
 * `delta_span_days` is returned so the UI can label the real span when a missed
 * cron day pushes the anchor further back than the nominal window.
 */
export function rollupAppProxySeries(
  series: AppProxyPoint[],
  windowDays = 30,
): AppProxyRollup | null {
  const sorted = [...series]
    .filter((p) => p.date && Number.isFinite(dayMs(p.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const targetMs = dayMs(latest.date) - windowDays * DAY_MS;

  // Ascending scan keeps the NEWEST row that is still old enough.
  let anchor: AppProxyPoint | null = null;
  for (const p of sorted) {
    if (dayMs(p.date) > targetMs) break;
    anchor = p;
  }

  const delta =
    anchor != null && anchor.rating_count != null && latest.rating_count != null
      ? latest.rating_count - anchor.rating_count
      : null;
  const span =
    anchor != null && delta != null
      ? Math.round((dayMs(latest.date) - dayMs(anchor.date)) / DAY_MS)
      : null;

  return {
    latest,
    rating_count_delta: delta,
    delta_span_days: span,
    history: sorted.map((p) => ({ asof: p.date, metric: p.rating_count })),
    days_observed: sorted.length,
  };
}

export interface RoyaltyCrossCheck {
  /** Total India recorded-music revenue — the pool the estimate must fit inside. */
  recorded_music_revenue_inr: number | null;
  /** share x recorded-music revenue: the most the label could earn on its own assumption. */
  ceiling_inr: number | null;
  /** Modelled annual mid. */
  implied_annual_inr: number;
  /** implied / ceiling. > 1 means the model breaks its own premise. */
  ceiling_ratio: number | null;
  /** Modelled annual mid as a share of the ENTIRE national market. */
  implied_share_of_market: number | null;
  /** Market-wide free-leg pool the per-stream rate implies, vs the whole market. */
  free_pool_inr: number | null;
  free_pool_vs_market: number | null;
  passed: boolean;
  failures: string[];
}

/** Ratio above which the estimate is treated as internally inconsistent. */
const ROYALTY_CEILING_TOLERANCE = 1.2;

/**
 * Reconcile a modelled royalty against the recorded-music pool reported by the
 * same source table.
 *
 * The bound is not a taste judgement, it is the model's own premise: if a label
 * is assumed to hold `share` of the catalog, its royalty cannot exceed `share`
 * of the national recorded-music revenue. When it does, an input is wrong.
 *
 * It currently DOES. EY-FICCI's ~6tn India stream count and the ₹0.10/stream
 * min-guarantee rate from the 2024 broker notes are on incompatible bases:
 * multiplied together they imply a ₹58,360cr market-wide free-tier royalty pool
 * against a ₹5,900cr recorded-music market — 9.9x the whole industry. The free
 * leg then contributes ~99% of the estimate and sizes these mid-caps at 30-50%
 * of national recorded music.
 *
 * Callers must not render a headline band when `passed` is false.
 */
export function computeRoyaltyCrossCheck(opts: {
  annual_mid_inr: number;
  assumed_catalog_share: number;
  recorded_music_revenue_inr: number | null;
  ad_streams: number | null;
  free_per_stream_inr?: number;
}): RoyaltyCrossCheck {
  const market = opts.recorded_music_revenue_inr;
  const perStream = opts.free_per_stream_inr ?? 0.1;
  const ceiling =
    market != null && market > 0 ? market * opts.assumed_catalog_share : null;
  const ceilingRatio =
    ceiling != null && ceiling > 0 ? opts.annual_mid_inr / ceiling : null;
  const impliedShare =
    market != null && market > 0 ? opts.annual_mid_inr / market : null;
  const freePool = opts.ad_streams != null ? opts.ad_streams * perStream : null;
  const freePoolVsMarket =
    freePool != null && market != null && market > 0 ? freePool / market : null;

  const failures: string[] = [];
  if (ceilingRatio != null && ceilingRatio > ROYALTY_CEILING_TOLERANCE) {
    failures.push(
      `Modelled royalty is ${ceilingRatio.toFixed(1)}x the most a ` +
        `${(opts.assumed_catalog_share * 100).toFixed(1)}% catalog share could earn from the ` +
        `entire India recorded-music market.`,
    );
  }
  if (freePoolVsMarket != null && freePoolVsMarket > 1) {
    failures.push(
      `The ₹${perStream.toFixed(2)}/stream rate applied to the reported ad-stream count ` +
        `implies a market-wide free-tier royalty pool ${freePoolVsMarket.toFixed(1)}x larger ` +
        `than total India recorded-music revenue — the two inputs are on incompatible bases.`,
    );
  }
  return {
    recorded_music_revenue_inr: market,
    ceiling_inr: ceiling,
    implied_annual_inr: opts.annual_mid_inr,
    ceiling_ratio: ceilingRatio,
    implied_share_of_market: impliedShare,
    free_pool_inr: freePool,
    free_pool_vs_market: freePoolVsMarket,
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Top-down, directional estimate of the label's audio-DSP "music licensing"
 * royalty — the dominant revenue line the YouTube layers do NOT capture. Pulls
 * India subscription revenue + ad-stream count from fct_dsp_market and applies
 * an ASSUMED catalog share. Graded 'D' by construction (see estimateStreamingRoyalty).
 */
