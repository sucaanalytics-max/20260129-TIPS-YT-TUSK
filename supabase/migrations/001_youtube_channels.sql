-- ============================================================
-- Migration 001: Multi-channel YouTube Analytics
-- Run in Supabase SQL editor (Table Editor → SQL Editor)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Channel registry
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS youtube_channels (
    channel_id   VARCHAR(30) PRIMARY KEY,   -- UCxxxxxx YouTube channel ID (or *_LEGACY)
    channel_name VARCHAR(120) NOT NULL,
    company      VARCHAR(20) NOT NULL CHECK (company IN ('TIPSMUSIC', 'SAREGAMA')),
    handle       VARCHAR(80),               -- Social Blade / YouTube handle (without @)
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yt_channels_company
    ON youtube_channels(company);

-- ------------------------------------------------------------
-- 2. Daily per-channel stats
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS youtube_channel_stats (
    id                BIGSERIAL PRIMARY KEY,
    channel_id        VARCHAR(30) NOT NULL REFERENCES youtube_channels(channel_id),
    date              DATE NOT NULL,
    total_views       BIGINT,         -- cumulative total views (from Social Blade)
    subscribers       BIGINT,         -- cumulative subscriber count
    video_count       INT,            -- cumulative upload count
    daily_views       BIGINT,         -- delta: today.views - yesterday.views (NULL on first day)
    daily_subscribers INT,            -- delta: today.subs  - yesterday.subs  (NULL on first day)
    daily_videos      INT,            -- delta: today.uploads - yesterday.uploads (often NULL)
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(channel_id, date)
);

CREATE INDEX IF NOT EXISTS idx_yt_stats_channel_date
    ON youtube_channel_stats(channel_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_yt_stats_date
    ON youtube_channel_stats(date DESC);

-- ------------------------------------------------------------
-- 3. Virtual legacy channels
--    These receive migrated rows from tips_youtube_data
--    and saregama_youtube_data (company-level aggregates).
--    is_active = false keeps them out of channel_latest_stats
--    but still included in company_daily_stats (no WHERE filter).
-- ------------------------------------------------------------
INSERT INTO youtube_channels (channel_id, channel_name, company, handle, is_active) VALUES
  ('TIPSMUSIC_LEGACY', 'Tips Music (Pre-2026 Aggregate)', 'TIPSMUSIC', NULL, false),
  ('SAREGAMA_LEGACY',  'Saregama (Pre-2026 Aggregate)',   'SAREGAMA',  NULL, false)
ON CONFLICT (channel_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Views
-- ------------------------------------------------------------

-- Company aggregate — all channels (active + legacy)
CREATE OR REPLACE VIEW company_daily_stats AS
SELECT
    ycs.date,
    c.company,
    SUM(ycs.daily_views)           AS daily_views,
    SUM(ycs.subscribers)           AS subscribers,
    SUM(ycs.total_views)           AS total_views,
    SUM(ycs.daily_subscribers)     AS daily_subscribers,
    SUM(ycs.daily_videos)          AS daily_videos,
    COUNT(DISTINCT ycs.channel_id) AS active_channels
FROM youtube_channel_stats ycs
JOIN youtube_channels c ON c.channel_id = ycs.channel_id
GROUP BY ycs.date, c.company;

-- Backward-compat named views (dashboard queries these instead of old tables)
CREATE OR REPLACE VIEW tips_youtube_data_v2 AS
    SELECT date, daily_views, subscribers, total_views, daily_subscribers, daily_videos
    FROM company_daily_stats
    WHERE company = 'TIPSMUSIC';

CREATE OR REPLACE VIEW saregama_youtube_data_v2 AS
    SELECT date, daily_views, subscribers, total_views, daily_subscribers, daily_videos
    FROM company_daily_stats
    WHERE company = 'SAREGAMA';

-- Latest stats per active channel (for channel breakdown table)
CREATE OR REPLACE VIEW channel_latest_stats AS
SELECT DISTINCT ON (c.channel_id)
    c.channel_id,
    c.channel_name,
    c.company,
    s.date,
    s.total_views,
    s.subscribers,
    s.daily_views,
    s.daily_subscribers,
    s.video_count
FROM youtube_channels c
JOIN youtube_channel_stats s ON s.channel_id = c.channel_id
WHERE c.is_active = true
ORDER BY c.channel_id, s.date DESC;

-- ------------------------------------------------------------
-- 5. Grants (required for Supabase REST anon access)
-- ------------------------------------------------------------
GRANT SELECT ON company_daily_stats      TO anon, authenticated;
GRANT SELECT ON tips_youtube_data_v2     TO anon, authenticated;
GRANT SELECT ON saregama_youtube_data_v2 TO anon, authenticated;
GRANT SELECT ON channel_latest_stats     TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
ALTER TABLE youtube_channels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_channel_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read" ON youtube_channels
    FOR SELECT USING (true);

CREATE POLICY "public read" ON youtube_channel_stats
    FOR SELECT USING (true);
