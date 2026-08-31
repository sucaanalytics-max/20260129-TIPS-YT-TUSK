-- v2/db/migrations/0028_revenue_nowcast.sql
-- =============================================================================
-- The nowcast as a TIME SERIES, not a single value.
--
-- One row per (company, fiscal quarter, as-of date). Watching the estimate move
-- as a quarter fills in is most of its diagnostic value: a nowcast that swings
-- wildly late in a quarter is telling you something a final number would hide.
--
-- drivers and assumptions are stored alongside each estimate so a past figure
-- can always be explained, even after the model or the defaults change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_revenue_nowcast (
  company          text NOT NULL REFERENCES dim_company(company),
  fiscal_label     text NOT NULL,          -- 'FY27 Q2'
  asof             date NOT NULL,
  band_low_inr     numeric NOT NULL,
  band_mid_inr     numeric NOT NULL,
  band_high_inr    numeric NOT NULL,
  projected_views  bigint  NOT NULL,
  quarter_progress numeric NOT NULL,
  drivers          jsonb   NOT NULL,
  assumptions      jsonb   NOT NULL,
  ingest_run_id    bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, fiscal_label, asof)
);

ALTER TABLE fct_revenue_nowcast DROP CONSTRAINT IF EXISTS fct_revenue_nowcast_band_chk;
ALTER TABLE fct_revenue_nowcast ADD CONSTRAINT fct_revenue_nowcast_band_chk
  CHECK (band_low_inr <= band_mid_inr AND band_mid_inr <= band_high_inr);

ALTER TABLE fct_revenue_nowcast DROP CONSTRAINT IF EXISTS fct_revenue_nowcast_progress_chk;
ALTER TABLE fct_revenue_nowcast ADD CONSTRAINT fct_revenue_nowcast_progress_chk
  CHECK (quarter_progress > 0 AND quarter_progress <= 1);

CREATE INDEX IF NOT EXISTS idx_revenue_nowcast_latest
  ON fct_revenue_nowcast (company, fiscal_label, asof DESC);

ALTER TABLE fct_revenue_nowcast ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_revenue_nowcast FROM anon, authenticated;
