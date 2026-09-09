-- Push catalogue-freshness aggregation into the database.
--
-- getSignalsSnapshot was reading fct_video_daily with NO video or channel
-- filter at all -- 172,900 rows over a 90-day window -- and PostgREST silently
-- capped it at 1000. Catalogue freshness, one of the eight signals behind the
-- Monitor read cards, was therefore computed from 0.6% of its data. It did not
-- error; it produced a confident wrong number.
--
-- Paging that read would mean ~173 round trips on a page render. The right
-- place for a 172k-row aggregation is the database, so this view returns one
-- row per video that actually earned views in the window: exactly the
-- (published_at, views_last_30d) pairs catalogFreshness consumes, and small
-- enough to page in a handful of requests.
--
-- Videos with no views in the window are excluded. They contribute zero to both
-- the numerator and the denominator of the freshness ratio, so dropping them
-- changes nothing and removes most of the rows.

CREATE OR REPLACE VIEW v_video_freshness_30d AS
SELECT
  c.company,
  v.video_id,
  v.published_at,
  SUM(f.daily_views)::bigint AS views_last_30d
FROM fct_video_daily f
JOIN dim_video   v ON v.video_id   = f.video_id
JOIN dim_channel c ON c.channel_id = v.channel_id
WHERE f.date >= (CURRENT_DATE - 30)
  AND f.daily_views IS NOT NULL
  AND c.company IS NOT NULL
GROUP BY c.company, v.video_id, v.published_at
HAVING SUM(f.daily_views) > 0;

COMMENT ON VIEW v_video_freshness_30d IS
  'Per-video views over the trailing 30 days, for catalogue freshness. Replaces a client-side aggregation over ~173k rows that PostgREST silently truncated to 1000.';
