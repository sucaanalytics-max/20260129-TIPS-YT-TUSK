-- Migration 002: Fix legacy channel double-counting in company_daily_stats
--
-- Problem: The original view summed daily_views across ALL channels (including
-- TIPSMUSIC_LEGACY / SAREGAMA_LEGACY with is_active=false). After backfilling
-- real per-channel data from Social Blade starting 2026-01-01, dates in that
-- range had both legacy aggregate rows AND real channel rows summed together,
-- causing an apparent views spike (~35M → ~50M) that is a data artifact.
--
-- Fix: UNION approach — active channels always included; legacy channels only
-- included for dates where no active channel data exists for that company.

CREATE OR REPLACE VIEW company_daily_stats AS

-- Active channels: real per-channel data (always included)
SELECT
    ycs.date,
    c.company,
    SUM(ycs.daily_views)           AS daily_views,
    SUM(ycs.total_views)           AS total_views,
    SUM(ycs.daily_subscribers)     AS daily_subscribers,
    SUM(ycs.daily_videos)          AS daily_videos,
    COUNT(DISTINCT ycs.channel_id) AS active_channels
FROM youtube_channel_stats ycs
JOIN youtube_channels c ON c.channel_id = ycs.channel_id
WHERE c.is_active = true
GROUP BY ycs.date, c.company

UNION ALL

-- Legacy channels: only for dates with NO active channel data for that company
-- (provides historical data before Social Blade backfill period)
SELECT
    ycs.date,
    c.company,
    SUM(ycs.daily_views)           AS daily_views,
    SUM(ycs.total_views)           AS total_views,
    SUM(ycs.daily_subscribers)     AS daily_subscribers,
    SUM(ycs.daily_videos)          AS daily_videos,
    COUNT(DISTINCT ycs.channel_id) AS active_channels
FROM youtube_channel_stats ycs
JOIN youtube_channels c ON c.channel_id = ycs.channel_id
WHERE c.is_active = false
  AND NOT EXISTS (
      SELECT 1
      FROM youtube_channel_stats ycs2
      JOIN youtube_channels c2 ON c2.channel_id = ycs2.channel_id
      WHERE c2.company = c.company
        AND c2.is_active = true
        AND ycs2.date = ycs.date
  )
GROUP BY ycs.date, c.company;
