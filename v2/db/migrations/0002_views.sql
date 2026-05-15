-- =============================================================================
-- Tusk YT × Stock — v2 derived views
-- Built on top of fct_*. SECURITY INVOKER (so RLS on base tables is respected).
-- =============================================================================

-- Company-level rollup of channel-day facts.
-- Mirrors v1 migration-002 UNION ALL semantics: active channels always counted;
-- legacy aggregates (is_active=false, e.g. TIPSMUSIC_LEGACY) counted only on
-- dates where no active channel has data. Preserves pre-2026 history.
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
  AND NOT EXISTS (
      SELECT 1
      FROM public.fct_channel_daily f2
      JOIN public.dim_channel c2 ON c2.channel_id = f2.channel_id
      WHERE c2.company = c.company
        AND c2.is_active = true
        AND f2.date = f.date
  )
GROUP BY f.date, c.company;

-- Latest stats per channel (drives the channel-leaderboard panel).
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
ORDER BY f.channel_id, f.date DESC;

-- Stock daily with derived change% (raw, not adjusted).
CREATE OR REPLACE VIEW public.v_price_with_change
WITH (security_invoker = true)
AS
SELECT
    symbol,
    date,
    close,
    adjusted_close,
    LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS prev_close,
    close - LAG(close) OVER (PARTITION BY symbol ORDER BY date) AS daily_change,
    CASE WHEN LAG(close) OVER (PARTITION BY symbol ORDER BY date) > 0
         THEN (close - LAG(close) OVER (PARTITION BY symbol ORDER BY date))
              / LAG(close) OVER (PARTITION BY symbol ORDER BY date) * 100
    END AS daily_change_pct,
    volume,
    source
FROM public.fct_price_daily;

-- Log-return based pair view for analytical work — joins TIPSMUSIC log-returns
-- with TIPSMUSIC company daily-views log-growth on the same trading date.
-- Frontend computes Pearson/Spearman on this directly. Stationarity respected.
CREATE OR REPLACE VIEW public.v_returns_join
WITH (security_invoker = true)
AS
WITH price AS (
    SELECT
        date,
        close,
        LN(close)::numeric - LN(LAG(close) OVER (ORDER BY date))::numeric AS log_return
    FROM public.fct_price_daily
    WHERE symbol = 'TIPSMUSIC'
),
views AS (
    SELECT
        date,
        daily_views,
        LN(NULLIF(daily_views, 0))::numeric
            - LN(NULLIF(LAG(daily_views) OVER (ORDER BY date), 0))::numeric AS log_growth_views
    FROM public.v_company_daily
    WHERE company = 'TIPSMUSIC'
)
SELECT
    p.date,
    p.close,
    p.log_return,
    v.daily_views,
    v.log_growth_views
FROM price p
JOIN views v ON v.date = p.date
WHERE p.log_return IS NOT NULL AND v.log_growth_views IS NOT NULL;
