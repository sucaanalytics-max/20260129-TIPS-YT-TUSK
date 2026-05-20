-- =============================================================================
-- Tusk YT v2 — Per-symbol stats tables
--
-- fct_correlation_window and fct_granger_summary were originally TIPSMUSIC-
-- only (the recompute.py service hardcoded the MV to TIPSMUSIC). That made
-- the lead-lag tile on /signals permanently "warming" for Saregama — half
-- our coverage was structurally blind.
--
-- This migration adds a `symbol` column to both tables and reshapes the
-- primary keys to include it, so a single table holds rows for every symbol
-- the service computes correlations for.
--
-- Backfill: existing rows are all TIPSMUSIC by definition (the only path
-- that wrote them). We backfill before tightening NOT NULL + PK to avoid
-- breaking active reads.
-- =============================================================================

-- --- fct_correlation_window -----------------------------------------------
ALTER TABLE fct_correlation_window
  ADD COLUMN IF NOT EXISTS symbol text;

UPDATE fct_correlation_window
SET symbol = 'TIPSMUSIC'
WHERE symbol IS NULL;

ALTER TABLE fct_correlation_window
  ALTER COLUMN symbol SET NOT NULL;

ALTER TABLE fct_correlation_window
  DROP CONSTRAINT IF EXISTS fct_correlation_window_pkey;
ALTER TABLE fct_correlation_window
  ADD PRIMARY KEY (symbol, asof, window_days, lag_days);

CREATE INDEX IF NOT EXISTS idx_fct_correlation_symbol_asof
  ON fct_correlation_window(symbol, asof DESC);

-- --- fct_granger_summary --------------------------------------------------
ALTER TABLE fct_granger_summary
  ADD COLUMN IF NOT EXISTS symbol text;

UPDATE fct_granger_summary
SET symbol = 'TIPSMUSIC'
WHERE symbol IS NULL;

ALTER TABLE fct_granger_summary
  ALTER COLUMN symbol SET NOT NULL;

ALTER TABLE fct_granger_summary
  DROP CONSTRAINT IF EXISTS fct_granger_summary_pkey;
ALTER TABLE fct_granger_summary
  ADD PRIMARY KEY (symbol, asof, direction, lag);

CREATE INDEX IF NOT EXISTS idx_fct_granger_symbol_asof
  ON fct_granger_summary(symbol, asof DESC);
