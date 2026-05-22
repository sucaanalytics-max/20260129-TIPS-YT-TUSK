/**
 * Backtesting harness for the modelled revenue estimates.
 *
 * Once we accumulate ≥ 1 full quarter of Topic + UGC daily data, this
 * function compares our modelled quarterly run-rate against the labels'
 * actual quarterly disclosures. The output drives CPM-calibration and
 * builds confidence in the estimator before we start citing the numbers
 * in IR briefings.
 *
 * Today: 1-2 days of Topic data, ~1 day of UGC data. Too early to
 * run. The function ALWAYS returns the shape below — callers can render
 * "awaiting Q1 data" until the window populates.
 *
 * Inputs (when ready):
 *   - quarter_start / quarter_end dates
 *   - Modelled attributed views: SUM over the quarter of topic_reach +
 *     ugc_reach attributed view totals per company
 *   - Actual quarterly revenue from earnings filing (manual input —
 *     publicly disclosed by both labels in their results)
 *
 * Outputs:
 *   - For each label: modelled quarterly band (low–high) vs actual
 *     quarterly music-licensing revenue
 *   - Calibration ratio = actual / modelled-mid. A ratio of 1.0 means
 *     the CPM model is perfectly calibrated for this label; >1 means
 *     our CPMs are too low; <1 means they're too high.
 *   - Per-label, per-quarter row stored in a fct_revenue_calibration
 *     table (to be added in a future migration)
 */
export interface BacktestResult {
  company: 'TIPSMUSIC' | 'SAREGAMA';
  quarter_label: string;
  modelled_low_inr: number;
  modelled_mid_inr: number;
  modelled_high_inr: number;
  actual_inr: number | null; // null until we have a filing for the quarter
  calibration_ratio: number | null; // null if actual missing
  in_band: boolean | null; // whether actual fell within low–high
  note: string;
}

export interface BacktestSnapshot {
  asof: string;
  ready: boolean; // false until ≥ 60 days of contiguous Topic data exists
  reason: string;
  rows: BacktestResult[];
}

/**
 * Stub — returns the not-ready snapshot until the data window is wide
 * enough to produce a quarterly modelled figure. The real implementation
 * will:
 *   1. Query fct_channel_daily over the quarter window
 *   2. Apply catalog_share weights from dim_artist_label
 *   3. Apply language-weighted CPM bands from lib/revenue-cpm.ts
 *   4. JOIN against a (future) dim_quarterly_disclosure table that holds
 *      manually-entered actual revenue per label per quarter
 *   5. Compute calibration_ratio + in_band per (company, quarter)
 *
 * Wired into the cockpit as a deferred future state: today the snapshot
 * shows "awaiting Q1 data" so the harness slot is visible.
 */
export function getBacktestSnapshot(): BacktestSnapshot {
  return {
    asof: new Date().toISOString().slice(0, 10),
    ready: false,
    reason:
      'Topic + UGC pipelines started 2026-05-21. Need ≥ 60 contiguous days for a quarter-aligned backtest. First eligible quarter window: ~2026-Q3 (Jul–Sep), with the result evaluable when Q3 earnings publish.',
    rows: [],
  };
}
