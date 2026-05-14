-- =============================================================================
-- Tusk YT v2 — baseline schema (clean, additive)
--
-- Apply against a NEW Supabase project (recommended) or a new schema in the
-- existing one. Do NOT apply on top of the legacy public.* tables.
--
-- Naming conventions:
--   dim_*  — slowly-changing dimensions (channels, videos, symbols, events)
--   fct_*  — daily facts (per channel-day, per video-day, per symbol-day)
--   raw_*  — immutable raw payloads from external APIs (replay capability)
--   ops_*  — operational tables (ingestion audit, error logs)
-- =============================================================================

-- ---- DIMENSIONS -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dim_company (
  company        text PRIMARY KEY,                          -- 'TIPSMUSIC', 'SAREGAMA'
  display_name   text NOT NULL,
  nse_symbol     text UNIQUE NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dim_channel (
  channel_id     text PRIMARY KEY,                          -- YouTube UCxxxxxx
  company        text NOT NULL REFERENCES dim_company(company),
  channel_name   text NOT NULL,
  handle         text,                                      -- with-or-without @
  uploads_playlist_id text,                                 -- UU... for playlistItems.list
  country        text,
  language       text,                                      -- primary language tag
  is_active      boolean NOT NULL DEFAULT true,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dim_channel_company ON dim_channel(company);
CREATE INDEX IF NOT EXISTS idx_dim_channel_active  ON dim_channel(is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS dim_video (
  video_id       text PRIMARY KEY,
  channel_id     text NOT NULL REFERENCES dim_channel(channel_id),
  title          text NOT NULL,
  published_at   timestamptz NOT NULL,
  duration_seconds int,
  category_id    int,
  language       text,
  audio_language text,
  is_short       boolean NOT NULL DEFAULT false,
  tags           text[],
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dim_video_channel    ON dim_video(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_dim_video_published  ON dim_video(published_at DESC);

CREATE TABLE IF NOT EXISTS dim_event (
  event_id       bigserial PRIMARY KEY,
  event_date     date NOT NULL,
  event_type     text NOT NULL,                             -- 'release' | 'earnings' | 'corp_action' | 'annotation'
  label          text NOT NULL,
  channel_id     text REFERENCES dim_channel(channel_id),
  video_id       text REFERENCES dim_video(video_id),
  company        text REFERENCES dim_company(company),
  meta           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dim_event_date    ON dim_event(event_date);
CREATE INDEX IF NOT EXISTS idx_dim_event_type    ON dim_event(event_type, event_date);
CREATE INDEX IF NOT EXISTS idx_dim_event_company ON dim_event(company, event_date);

CREATE TABLE IF NOT EXISTS dim_corporate_action (
  symbol         text NOT NULL,
  ex_date        date NOT NULL,
  action_type    text NOT NULL,                             -- 'split' | 'bonus' | 'dividend' | 'rights' | 'merger'
  ratio_num      numeric,                                   -- e.g. 1 of 1:1 bonus
  ratio_den      numeric,                                   -- e.g. 1 of 1:1 bonus
  cash_per_share numeric,                                   -- for dividends
  record_date    date,
  meta           jsonb,
  PRIMARY KEY (symbol, ex_date, action_type)
);

-- ---- FACTS ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fct_channel_daily (
  channel_id        text NOT NULL REFERENCES dim_channel(channel_id),
  date              date NOT NULL,
  total_views       bigint,                  -- cumulative
  subscribers       bigint,                  -- cumulative
  video_count       int,                     -- cumulative
  daily_views       bigint,                  -- delta from previous day; null on first row or gap
  daily_subscribers int,
  daily_videos      int,
  ingest_run_id   bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, date),
  CHECK (daily_views IS NULL OR (daily_views >= 0 AND daily_views < 500000000)),
  CHECK (daily_subscribers IS NULL OR daily_subscribers BETWEEN -500000 AND 5000000),
  CHECK (daily_videos IS NULL OR daily_videos BETWEEN -10000 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_fct_channel_daily_date ON fct_channel_daily(date DESC);

CREATE TABLE IF NOT EXISTS fct_video_daily (
  video_id          text NOT NULL REFERENCES dim_video(video_id),
  date              date NOT NULL,
  views             bigint,
  likes             int,
  comments          int,
  daily_views       bigint,                                 -- delta day-over-day
  ingest_run_id   bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, date)
);

CREATE INDEX IF NOT EXISTS idx_fct_video_daily_date ON fct_video_daily(date DESC);

CREATE TABLE IF NOT EXISTS fct_price_daily (
  symbol            text NOT NULL,
  date              date NOT NULL,
  open              numeric(12, 2),
  high              numeric(12, 2),
  low               numeric(12, 2),
  close             numeric(12, 2) NOT NULL,
  adjusted_close    numeric(12, 2),                         -- corporate-action-adjusted
  daily_change      numeric(12, 2),                         -- close - prev_close
  daily_change_pct  numeric(8, 4),                          -- 100 * (close/prev - 1)
  volume            bigint,
  source            text NOT NULL,                          -- 'yahoo_finance' | 'nse_india'
  ingest_run_id   bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date),
  CHECK (close > 0),
  CHECK (high IS NULL OR low IS NULL OR high >= low)
);

CREATE INDEX IF NOT EXISTS idx_fct_price_daily_date ON fct_price_daily(date DESC);

-- ---- RAW PAYLOADS (replayability) ------------------------------------------

CREATE TABLE IF NOT EXISTS raw_youtube_api (
  id               bigserial PRIMARY KEY,
  endpoint         text NOT NULL,                           -- 'channels.list' | 'videos.list' | 'playlistItems.list'
  request_params   jsonb,                                   -- ids, params snapshot
  response_payload jsonb NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  ingest_run_id    bigint
);

CREATE INDEX IF NOT EXISTS idx_raw_youtube_api_fetched ON raw_youtube_api(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_youtube_api_endpoint ON raw_youtube_api(endpoint, fetched_at DESC);

CREATE TABLE IF NOT EXISTS raw_stock (
  id               bigserial PRIMARY KEY,
  source           text NOT NULL,                           -- 'yahoo_finance' | 'nse_india'
  symbol           text NOT NULL,
  response_payload jsonb NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  ingest_run_id    bigint
);

CREATE INDEX IF NOT EXISTS idx_raw_stock_fetched ON raw_stock(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_stock_symbol  ON raw_stock(symbol, fetched_at DESC);

-- ---- OPS --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops_ingest_run (
  run_id          bigserial PRIMARY KEY,
  source          text NOT NULL,                            -- 'youtube_channels' | 'youtube_videos' | 'stocks' | 'corporate_actions'
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  status          text NOT NULL DEFAULT 'running',          -- 'running' | 'ok' | 'partial' | 'failed'
  rows_in         int,
  rows_out        int,
  detail          jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_ingest_run_source ON ops_ingest_run(source, started_at DESC);

CREATE TABLE IF NOT EXISTS ops_error_log (
  id              bigserial PRIMARY KEY,
  error_type      text NOT NULL,
  error_message   text NOT NULL,
  detail          jsonb,
  ingest_run_id   bigint REFERENCES ops_ingest_run(run_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_error_log_type    ON ops_error_log(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_error_log_created ON ops_error_log(created_at DESC);

-- ---- RLS: service-role only -------------------------------------------------
-- All reads in v2 go through Next.js Route Handlers using the service-role key
-- (Clerk-gated). No anon access. Zero policies = effective deny for anon/auth.

ALTER TABLE dim_company           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_channel           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_video             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_event             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_corporate_action  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_channel_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_video_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_price_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_youtube_api       ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_stock             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_ingest_run        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_error_log         ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- ---- DERIVED VIEWS ----------------------------------------------------------

-- NOTE: Aggregate / correlation views live in 0002_views.sql:
--   v_company_daily      — company-level rollup
--   v_channel_latest     — latest stats per channel
--   v_price_with_change  — price with prev-close-derived change
--   v_returns_join       — log-return correlation pair view
