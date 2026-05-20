-- =============================================================================
-- Tusk YT v2 — Owned-only filters on aggregate views
--
-- Migration 0009 made dim_channel.company nullable to support Topic / OAC
-- channels (which aggregate across labels). v_company_daily and
-- v_channel_latest were written before that change and now silently emit
-- company=NULL rows that downstream queries don't filter out.
--
-- This migration tightens both views to ONLY surface owned, company-scoped
-- channels. Topic/OAC reach is queried separately via dim_artist_label
-- attribution (see getTopicReach in lib/queries.ts).
--
-- Behaviour change for existing callers:
--   - getChannelLeaderboard / getLanguageRollup will no longer see Topic
--     channels (correct — they have NULL company and shouldn't be in those
--     leaderboards)
--   - getSignalsSnapshot continues to work identically (it already filtered
--     .eq('company', X) downstream, so the v_company_daily NULL bucket was
--     never reaching it)
-- =============================================================================

CREATE OR REPLACE VIEW public.v_company_daily
WITH (security_invoker = true)
AS
SELECT
    f.date,
    c.company,
    SUM(f.daily_views)       AS daily_views,
    SUM(f.daily_subscribers) AS daily_subscribers,
    SUM(f.daily_videos)      AS daily_videos,
    SUM(f.total_views)       AS total_views,
    SUM(f.subscribers)       AS subscribers,
    COUNT(DISTINCT f.channel_id) AS channels_with_data
FROM public.fct_channel_daily f
JOIN public.dim_channel c ON c.channel_id = f.channel_id
WHERE c.is_active = true
  AND c.channel_type = 'owned'
  AND c.company IS NOT NULL
GROUP BY f.date, c.company

UNION ALL

SELECT
    f.date,
    c.company,
    SUM(f.daily_views)       AS daily_views,
    SUM(f.daily_subscribers) AS daily_subscribers,
    SUM(f.daily_videos)      AS daily_videos,
    SUM(f.total_views)       AS total_views,
    SUM(f.subscribers)       AS subscribers,
    COUNT(DISTINCT f.channel_id) AS channels_with_data
FROM public.fct_channel_daily f
JOIN public.dim_channel c ON c.channel_id = f.channel_id
WHERE c.is_active = false
  AND c.channel_type = 'owned'
  AND c.company IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.fct_channel_daily f2
      JOIN public.dim_channel c2 ON c2.channel_id = f2.channel_id
      WHERE c2.company = c.company
        AND c2.is_active = true
        AND c2.channel_type = 'owned'
        AND f2.date = f.date
  )
GROUP BY f.date, c.company;

CREATE OR REPLACE VIEW public.v_channel_latest
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (f.channel_id)
    f.channel_id,
    c.channel_name,
    c.company,
    c.language,
    f.date,
    f.total_views,
    f.subscribers,
    f.video_count,
    f.daily_views,
    f.daily_subscribers,
    f.daily_videos
FROM public.fct_channel_daily f
JOIN public.dim_channel c ON c.channel_id = f.channel_id
WHERE c.is_active = true
  AND c.channel_type = 'owned'
  AND c.company IS NOT NULL
ORDER BY f.channel_id, f.date DESC;
