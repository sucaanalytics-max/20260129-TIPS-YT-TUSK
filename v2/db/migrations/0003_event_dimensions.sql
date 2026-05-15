-- =============================================================================
-- Tusk YT v2 — event source dimensions
--
-- dim_earnings_event   results-announcement dates from BSE
-- dim_film_release     manually curated Tips Films / banner release calendar
-- dim_market_index     NIFTY MIDCAP 150 + NIFTY 50 daily close (market-model β)
-- =============================================================================

CREATE TABLE IF NOT EXISTS dim_earnings_event (
  symbol              text NOT NULL REFERENCES dim_company(nse_symbol),
  event_date          date NOT NULL,
  period              text NOT NULL,                          -- 'Q1 FY25' etc.
  board_meeting_date  date,
  results_pdf_url     text,
  source              text NOT NULL DEFAULT 'bse',            -- 'bse' | 'nse' | 'manual'
  meta                jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, event_date)
);

CREATE INDEX IF NOT EXISTS idx_dim_earnings_event_date
  ON dim_earnings_event(event_date DESC);

CREATE TABLE IF NOT EXISTS dim_film_release (
  release_date    date NOT NULL,
  film_title      text NOT NULL,
  channel_id      text REFERENCES dim_channel(channel_id),
  company         text REFERENCES dim_company(company),
  banner          text,                                       -- 'Tips Films' | 'Saregama Yoodlee' | partner
  language        text,
  budget_inr_cr   numeric,
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_date, film_title)
);

CREATE INDEX IF NOT EXISTS idx_dim_film_release_company
  ON dim_film_release(company, release_date DESC);

CREATE TABLE IF NOT EXISTS dim_market_index (
  index_name      text NOT NULL,                              -- 'NIFTY_MIDCAP_150' | 'NIFTY_50'
  date            date NOT NULL,
  open            numeric(12, 2),
  high            numeric(12, 2),
  low             numeric(12, 2),
  close           numeric(12, 2) NOT NULL,
  volume          bigint,
  source          text NOT NULL DEFAULT 'yahoo_finance',
  ingest_run_id   bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (index_name, date),
  CHECK (close > 0),
  CHECK (high IS NULL OR low IS NULL OR high >= low)
);

CREATE INDEX IF NOT EXISTS idx_dim_market_index_date
  ON dim_market_index(date DESC);

ALTER TABLE dim_earnings_event  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_film_release    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_market_index    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON dim_earnings_event, dim_film_release, dim_market_index FROM anon, authenticated;

-- ---- dim_event upsert keys --------------------------------------------------
-- Lets the videos cron upsert release events keyed by (event_type, video_id)
-- and the corporate-actions cron upsert corp-action events keyed by
-- (event_type, company, event_date, label).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_event_video
  ON dim_event(event_type, video_id) WHERE video_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_event_company_date
  ON dim_event(event_type, company, event_date, label) WHERE company IS NOT NULL;
