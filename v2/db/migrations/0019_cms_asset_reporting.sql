-- =============================================================================
-- Tusk YT v2 — CMS Asset Reporting (dormant scaffold)
--
-- Schema for the YouTube Content Owner Reporting API output. Dormant until
-- the label provides a service-account JSON with onBehalfOfContentOwner
-- access — see /api/cron/cms-reporting/route.ts and
-- env.YT_CMS_SERVICE_ACCOUNT_JSON.
--
-- The Reporting API delivers daily gzipped CSVs. The cron downloads them,
-- parses, and upserts into the two tables below. When access is granted,
-- the data flows; until then both tables stay empty.
--
-- Source spec:
--   content_owner_asset_basic_a3 — view-level metrics per (asset, video, day)
--   content_owner_asset_estimated_revenue_a1 — partner revenue per (asset, video, day)
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_cms_asset_daily (
  -- Composite key: one row per (asset, video, day, uploader_type, country)
  -- The Reporting API dimensions you can vary; we pin the rest.
  date              date NOT NULL,
  asset_id          text NOT NULL,
  video_id          text NOT NULL,
  -- 'self' (the label uploaded the video) | 'thirdParty' (UGC)
  uploader_type     text NOT NULL,
  -- 'claimed' | 'unclaimed' — claimed means Content ID is monetizing it for us
  claimed_status    text NOT NULL,
  country_code      text NOT NULL DEFAULT 'ZZ', -- 'ZZ' for "all/global"
  -- Owning company. Resolved from the Content Owner ID at ingest time.
  company           text REFERENCES dim_company(company),
  -- View-level metrics
  views             bigint,
  engaged_views     bigint,
  watch_time_minutes numeric(14, 2),
  avg_view_duration_seconds numeric(10, 2),
  likes             bigint,
  dislikes          bigint,
  comments          bigint,
  shares            bigint,
  red_views         bigint,
  red_watch_time_minutes numeric(14, 2),
  -- Audit
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, asset_id, video_id, uploader_type, claimed_status, country_code)
);

CREATE INDEX IF NOT EXISTS idx_fct_cms_asset_daily_date
  ON fct_cms_asset_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_fct_cms_asset_daily_asset
  ON fct_cms_asset_daily (asset_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_fct_cms_asset_daily_company
  ON fct_cms_asset_daily (company, date DESC) WHERE company IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fct_cms_asset_daily_uploader
  ON fct_cms_asset_daily (uploader_type, date DESC);

-- Revenue report — the goal of the entire CMS access pursuit
CREATE TABLE IF NOT EXISTS fct_cms_asset_revenue_daily (
  date              date NOT NULL,
  asset_id          text NOT NULL,
  video_id          text NOT NULL,
  uploader_type     text NOT NULL,
  claimed_status    text NOT NULL,
  country_code      text NOT NULL DEFAULT 'ZZ',
  company           text REFERENCES dim_company(company),
  -- Revenue figures in USD per the Reporting API (will convert to INR
  -- downstream using fct_fx_daily or a simple constant for now).
  estimated_partner_revenue_usd        numeric(14, 4),
  estimated_partner_ad_revenue_auction_usd numeric(14, 4),
  estimated_partner_ad_revenue_reserved_usd numeric(14, 4),
  estimated_partner_red_revenue_usd    numeric(14, 4),
  estimated_partner_transaction_revenue_usd numeric(14, 4),
  ingest_run_id     bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, asset_id, video_id, uploader_type, claimed_status, country_code)
);

CREATE INDEX IF NOT EXISTS idx_fct_cms_revenue_daily_company_date
  ON fct_cms_asset_revenue_daily (company, date DESC) WHERE company IS NOT NULL;

-- One row per Reporting API job we've scheduled (deduplicates job creation)
CREATE TABLE IF NOT EXISTS ops_cms_reporting_job (
  report_type_id    text NOT NULL,         -- e.g. 'content_owner_asset_basic_a3'
  content_owner_id  text NOT NULL,         -- the label's CMS partner ID
  yt_job_id         text NOT NULL UNIQUE,  -- ID returned by YT jobs.create
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  PRIMARY KEY (report_type_id, content_owner_id)
);

ALTER TABLE fct_cms_asset_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_cms_asset_revenue_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_cms_reporting_job        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_cms_asset_daily, fct_cms_asset_revenue_daily, ops_cms_reporting_job
  FROM anon, authenticated;
