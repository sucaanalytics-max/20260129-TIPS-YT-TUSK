-- Migration 003: Remove invalid daily_views rows (zero, null, negative, impossible spikes)
--
-- Root cause: daily_views is stored as total_views[today] - total_views[yesterday].
-- This produces invalid rows when:
--   1. YouTube audits remove bot/invalid views → cumulative total drops → negative delta
--   2. Scraper misses days → multi-day gap computed as single-day delta → huge positive spike
--   3. Channels with no data → daily_views = 0 or NULL
--
-- These channels collectively generate 30-50M views/day across 15 channels,
-- so 0/negative values and values >200M per-row are never real data.
--
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/bfafqccvzboyfjewzvhk/sql

-- Step 1: Preview negative rows by channel
SELECT channel_id, COUNT(*) AS neg_rows, MIN(daily_views) AS worst_negative
FROM youtube_channel_stats
WHERE daily_views < 0
GROUP BY channel_id ORDER BY worst_negative ASC;

-- Step 2: Preview impossible positive spikes (>200M for a single channel in one day)
SELECT channel_id, date, daily_views
FROM youtube_channel_stats
WHERE daily_views > 200000000
ORDER BY daily_views DESC;

-- Step 3: Preview zero/null rows
SELECT channel_id, COUNT(*) AS zero_rows, MIN(date), MAX(date)
FROM youtube_channel_stats
WHERE daily_views = 0 OR daily_views IS NULL
GROUP BY channel_id ORDER BY zero_rows DESC;

-- Step 4: Delete all invalid rows
-- Run this AFTER reviewing steps 1-3 to confirm scope
DELETE FROM youtube_channel_stats
WHERE daily_views <= 0
   OR daily_views IS NULL
   OR daily_views > 200000000;
