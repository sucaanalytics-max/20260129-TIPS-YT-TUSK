-- =============================================================================
-- Tusk YT v2 — statistical outputs
--
-- Pre-computed tables written by the Python stats service. UI queries only
-- read these — never invokes the Python service inline. Joined on trading
-- dates only (weekends/holidays excluded) to avoid spurious zero-return rows.
-- =============================================================================

-- ---- Materialized returns join ---------------------------------------------
-- Same shape as v_returns_join but persisted so the Python service can pull
-- a stable snapshot per-asof. Refreshed by /api/stats/recompute.
CREATE MATERIALIZED VIEW IF NOT EXISTS fct_returns_daily AS
WITH price AS (
  SELECT
    date,
    close,
    LN(close)::numeric - LN(LAG(close) OVER (ORDER BY date))::numeric AS log_return
  FROM fct_price_daily
  WHERE symbol = 'TIPSMUSIC'
),
views AS (
  SELECT
    date,
    daily_views,
    LN(NULLIF(daily_views, 0))::numeric
      - LN(NULLIF(LAG(daily_views) OVER (ORDER BY date), 0))::numeric AS log_growth_views
  FROM v_company_daily
  WHERE company = 'TIPSMUSIC'
),
mkt AS (
  SELECT
    date,
    close AS index_close,
    LN(close)::numeric - LN(LAG(close) OVER (ORDER BY date))::numeric AS log_return_mkt
  FROM dim_market_index
  WHERE index_name = 'NIFTY_MIDCAP_150'
)
SELECT
  p.date,
  p.close,
  p.log_return,
  v.daily_views,
  v.log_growth_views,
  mkt.index_close,
  mkt.log_return_mkt
FROM price p
INNER JOIN views v ON v.date = p.date
LEFT JOIN mkt ON mkt.date = p.date
WHERE p.log_return IS NOT NULL
  AND v.log_growth_views IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fct_returns_daily_date
  ON fct_returns_daily(date);

-- ---- Rolling correlation grid ----------------------------------------------
CREATE TABLE IF NOT EXISTS fct_correlation_window (
  asof              date NOT NULL,
  window_days       int NOT NULL,                             -- 7, 30, 60, 120
  lag_days          int NOT NULL,                             -- -10..+10; +k = views lead by k
  pearson_r         numeric(8, 6),
  spearman_rho      numeric(8, 6),
  n_obs             int NOT NULL,
  p_value_raw       numeric(10, 8),
  p_value_fdr       numeric(10, 8),
  is_significant    boolean,                                  -- p_value_fdr < 0.05 AND n_obs >= window_days/2
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asof, window_days, lag_days)
);

CREATE INDEX IF NOT EXISTS idx_fct_correlation_asof
  ON fct_correlation_window(asof DESC);
CREATE INDEX IF NOT EXISTS idx_fct_correlation_window_lag
  ON fct_correlation_window(window_days, lag_days);

-- ---- Event study output ----------------------------------------------------
-- Aggregated by event_type over a rolling 365-day cohort. day_offset is the
-- trading-day offset from the event (negative = pre-event).
CREATE TABLE IF NOT EXISTS fct_event_study (
  asof              date NOT NULL,
  event_type        text NOT NULL,                            -- 'release' | 'film_release' | 'earnings' | 'split' | 'bonus' | 'dividend'
  day_offset        int NOT NULL,                             -- -5..+5 trading days
  mean_ar           numeric(10, 6),                           -- abnormal return on day_offset
  mean_car          numeric(10, 6),                           -- cumulative abnormal return through day_offset
  ci_lo             numeric(10, 6),                           -- 95% CI low (bootstrap)
  ci_hi             numeric(10, 6),
  n_obs             int NOT NULL,
  n_dropped         int NOT NULL DEFAULT 0,                   -- events dropped for overlap
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asof, event_type, day_offset)
);

CREATE INDEX IF NOT EXISTS idx_fct_event_study_asof
  ON fct_event_study(asof DESC, event_type);

-- ---- Granger summary (per asof) --------------------------------------------
CREATE TABLE IF NOT EXISTS fct_granger_summary (
  asof              date NOT NULL,
  direction         text NOT NULL,                            -- 'views_to_returns' | 'returns_to_views'
  lag               int NOT NULL,                             -- 1..10
  f_statistic       numeric(12, 6),
  p_value           numeric(10, 8),
  n_obs             int NOT NULL,
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asof, direction, lag)
);

CREATE INDEX IF NOT EXISTS idx_fct_granger_asof
  ON fct_granger_summary(asof DESC);

ALTER TABLE fct_correlation_window  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_event_study         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_granger_summary     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fct_correlation_window, fct_event_study, fct_granger_summary
  FROM anon, authenticated;

-- Materialized view grants — service-role only by default. Anon/auth revoke
-- via the global revoke in 0001_baseline.sql; an MV created later needs an
-- explicit revoke since it didn't exist at migration time.
REVOKE ALL ON fct_returns_daily FROM anon, authenticated;
