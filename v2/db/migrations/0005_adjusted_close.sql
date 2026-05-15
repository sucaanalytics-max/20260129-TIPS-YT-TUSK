-- =============================================================================
-- Tusk YT v2 — adjusted close producer
--
-- fct_adjusted_price_daily holds split/bonus/dividend-adjusted closes so that
-- log-returns are continuous through corporate action ex-dates.
--
-- recompute_adjusted_close(symbol) walks dim_corporate_action ordered by
-- ex_date DESC and applies a cumulative back-adjustment factor:
--
--   split / bonus N:M  → multiply pre-ex prices by M / (N + M)
--                        (e.g. 1:5 split → factor 1/(1+5) = 0.1667 on pre-ex prices)
--                        (e.g. 1:1 bonus → factor 1/(1+1) = 0.5)
--   cash dividend D    → multiply pre-ex prices by (close_on_ex - D) / close_on_ex
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_adjusted_price_daily (
  symbol              text NOT NULL,
  date                date NOT NULL,
  close               numeric(12, 4) NOT NULL,
  adjusted_close      numeric(12, 4) NOT NULL,
  cum_factor          numeric(16, 10) NOT NULL,               -- product of (factor) for all ex-dates AFTER `date`
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date),
  CHECK (close > 0),
  CHECK (adjusted_close > 0),
  CHECK (cum_factor > 0)
);

CREATE INDEX IF NOT EXISTS idx_fct_adjusted_price_symbol_date
  ON fct_adjusted_price_daily(symbol, date DESC);

ALTER TABLE fct_adjusted_price_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_adjusted_price_daily FROM anon, authenticated;

-- ---- Recompute function ----------------------------------------------------
CREATE OR REPLACE FUNCTION recompute_adjusted_close(target_symbol text)
RETURNS TABLE (rows_written int, actions_applied int) AS $$
DECLARE
  v_rows_written int := 0;
  v_actions_applied int := 0;
BEGIN
  -- Snapshot of corporate actions ordered most-recent-first; we walk these
  -- in temporal order to build the cumulative factor applied to dates BEFORE
  -- each ex-date.
  CREATE TEMP TABLE _ca ON COMMIT DROP AS
    SELECT
      ex_date,
      action_type,
      ratio_num,
      ratio_den,
      cash_per_share
    FROM dim_corporate_action
    WHERE symbol = target_symbol
    ORDER BY ex_date DESC;

  -- Build a per-(symbol, date) row with cumulative factor. The cum_factor
  -- starts at 1.0 for the most recent price row and accumulates back in time:
  -- whenever a row's date < ex_date of the next-encountered corporate action,
  -- the factor for that ex_date enters the product.
  CREATE TEMP TABLE _prices ON COMMIT DROP AS
    SELECT symbol, date, close
    FROM fct_price_daily
    WHERE symbol = target_symbol
    ORDER BY date ASC;

  -- The factor for a given ex_date:
  --   split  ratio_num : ratio_den  → ratio_den / (ratio_num + ratio_den)
  --   bonus  ratio_num : ratio_den  → ratio_den / (ratio_num + ratio_den)
  --   dividend D                    → 1 - D / close_at_ex_minus_1
  -- (rights/merger handled as 1.0 — flagged for manual review)
  WITH ex_factors AS (
    SELECT
      ca.ex_date,
      CASE
        WHEN ca.action_type IN ('split', 'bonus')
             AND ca.ratio_num IS NOT NULL
             AND ca.ratio_den IS NOT NULL
             AND ca.ratio_num + ca.ratio_den > 0
          THEN ca.ratio_den::numeric / (ca.ratio_num + ca.ratio_den)
        WHEN ca.action_type = 'dividend' AND ca.cash_per_share IS NOT NULL
          THEN GREATEST(
            (SELECT 1 - ca.cash_per_share / NULLIF(p.close, 0)
             FROM _prices p
             WHERE p.date < ca.ex_date
             ORDER BY p.date DESC LIMIT 1),
            0.0001
          )
        ELSE 1.0
      END AS factor
    FROM dim_corporate_action ca
    WHERE ca.symbol = target_symbol
  ),
  adjusted AS (
    SELECT
      p.symbol,
      p.date,
      p.close,
      COALESCE(
        (SELECT exp(SUM(LN(ef.factor)))
         FROM ex_factors ef
         WHERE ef.ex_date > p.date),
        1.0
      )::numeric(16, 10) AS cum_factor
    FROM _prices p
  )
  INSERT INTO fct_adjusted_price_daily AS dst (symbol, date, close, adjusted_close, cum_factor, updated_at)
  SELECT
    a.symbol,
    a.date,
    a.close,
    (a.close * a.cum_factor)::numeric(12, 4),
    a.cum_factor,
    now()
  FROM adjusted a
  ON CONFLICT (symbol, date) DO UPDATE
  SET close          = EXCLUDED.close,
      adjusted_close = EXCLUDED.adjusted_close,
      cum_factor     = EXCLUDED.cum_factor,
      updated_at     = now();

  GET DIAGNOSTICS v_rows_written = ROW_COUNT;
  SELECT COUNT(*) INTO v_actions_applied FROM dim_corporate_action WHERE symbol = target_symbol;

  RETURN QUERY SELECT v_rows_written, v_actions_applied;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION recompute_adjusted_close(text) FROM anon, authenticated;

-- ---- Convenience view: price with adjusted overlay -------------------------
CREATE OR REPLACE VIEW v_price_adjusted
WITH (security_invoker = true)
AS
SELECT
  p.symbol,
  p.date,
  p.close,
  COALESCE(a.adjusted_close, p.close) AS adjusted_close,
  p.volume,
  p.source
FROM fct_price_daily p
LEFT JOIN fct_adjusted_price_daily a
  ON a.symbol = p.symbol AND a.date = p.date;
