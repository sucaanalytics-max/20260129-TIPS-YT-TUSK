-- =============================================================================
-- Tusk YT v2 — App-download / demand proxies + catalog chart presence (B3 / A4)
--
-- fct_app_proxy_daily      — automated daily snapshot of public app-store
--                            signals per DSP app (ratings count/avg, Play
--                            install bucket, and — when a licensed vendor is
--                            configured — download/MAU/IAP-revenue estimates).
--                            One row per (dsp, store, country, date, source).
--
-- fct_catalog_chart_presence — Apple "most-played" India song-chart entries
--                            with a flag for whether the credited artist
--                            matches the labels' catalog (the LEGAL substitute
--                            for DSP playlist-placement tracking, which is
--                            closed/ToS-risky on Spotify/JioSaavn/Gaana).
--
-- ⚠️ These are GROSS funnel-top demand signals, never paid-subscriber counts.
-- Ratings/installs are cumulative and never decrement for churn. Graded LOW.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_app_proxy_daily (
  dsp                  text NOT NULL,                  -- FK semantics → dim_dsp.dsp
  store                text NOT NULL,                  -- 'app_store' | 'play_store'
  country              text NOT NULL DEFAULT 'IN',
  date                 date NOT NULL,
  source               text NOT NULL,                  -- 'itunes_lookup' | 'play_scraper' | 'apple_rss' | 'appfigures'
  chart_rank           int,                            -- rank in apps chart (often null: v2 RSS has no category filter)
  chart_kind           text,                           -- 'apps_top_free' | 'apps_top_paid'
  rating_count         bigint,                         -- cumulative ratings (this storefront)
  rating_avg           numeric(3, 2),
  install_bucket       text,                           -- Play only, e.g. '500,000,000+'
  min_installs         bigint,
  downloads_est        bigint,                         -- licensed vendor (Appfigures) only
  mau_est              bigint,                         -- licensed vendor only
  iap_revenue_est_usd  numeric(14, 2),                 -- licensed vendor only (best paid proxy)
  ingest_run_id        bigint,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dsp, store, country, date, source)
);

ALTER TABLE fct_app_proxy_daily DROP CONSTRAINT IF EXISTS fct_app_proxy_store_chk;
ALTER TABLE fct_app_proxy_daily ADD CONSTRAINT fct_app_proxy_store_chk
  CHECK (store IN ('app_store', 'play_store'));

CREATE INDEX IF NOT EXISTS idx_fct_app_proxy_dsp_date
  ON fct_app_proxy_daily (dsp, date DESC);
CREATE INDEX IF NOT EXISTS idx_fct_app_proxy_date
  ON fct_app_proxy_daily (date DESC);

CREATE TABLE IF NOT EXISTS fct_catalog_chart_presence (
  chart             text NOT NULL,                     -- e.g. 'apple_music_songs'
  country           text NOT NULL DEFAULT 'IN',
  date              date NOT NULL,
  rank              int NOT NULL,
  track_title       text,
  artist            text,
  is_catalog_match  boolean NOT NULL DEFAULT false,
  matched_company   text REFERENCES dim_company(company),
  matched_artist    text,
  source            text,
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chart, country, date, rank)
);

CREATE INDEX IF NOT EXISTS idx_fct_chart_presence_match
  ON fct_catalog_chart_presence (date DESC, is_catalog_match);

ALTER TABLE fct_app_proxy_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_catalog_chart_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_app_proxy_daily, fct_catalog_chart_presence FROM anon, authenticated;
