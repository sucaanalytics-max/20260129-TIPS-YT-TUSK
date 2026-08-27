-- =============================================================================
-- Tusk YT v2 — UGC discovery work-queue (cursor-batched sweeps)
--
-- The single weekly ugc-discovery cron did discover→enrich→attribute→resolve
-- in one Vercel function and hit the maxDuration=300 cap (the 2026-05-31 run
-- wedged in 'running'). Widening coverage (anchoring on ALL owned+topic videos
-- above a view threshold, not just top-25) makes one-shot impossible.
--
-- This work-queue decouples the sweep from a single invocation:
--   * a PLANNER seeds one row per anchor for the sweep (status='pending')
--   * a WORKER cron drains a bounded slice per tick (always < 300s), scraping
--     the Shorts pivot and marking each anchor 'done'/'error'. Idempotent — a
--     failed slice simply re-runs next tick; nothing strands.
--
-- `truncated` records that the pivot hit its cap (more Shorts exist than we
-- captured) so downstream reach totals are labelled "sampled lower bound".
--
-- Operational table (not a fact table): no FK on source_video_id — the planner
-- always seeds from dim_video, so rows are valid by construction, and we don't
-- want a later dim_video delete to cascade-break an in-flight sweep.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ugc_discovery_queue (
  sweep_date       date NOT NULL,
  source_video_id  text NOT NULL,
  company          text,
  source_kind      text NOT NULL DEFAULT 'owned',   -- 'owned' | 'topic'
  status           text NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'error'
  attempts         int  NOT NULL DEFAULT 0,
  matches          int,                              -- UGC Shorts found this sweep
  truncated        boolean,                          -- pivot capped → undercount
  error            text,
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sweep_date, source_video_id)
);

-- Worker drains by (sweep_date, status); this index keeps the "next pending
-- slice" lookup cheap.
CREATE INDEX IF NOT EXISTS idx_ugc_queue_sweep_status
  ON ugc_discovery_queue (sweep_date, status);

ALTER TABLE ugc_discovery_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ugc_discovery_queue FROM anon, authenticated;

-- Anchor selection: every owned+topic long-form video whose latest cumulative
-- views clear a threshold, newest-views first, capped. DISTINCT ON gets each
-- video's most recent fct_video_daily row efficiently via the (video_id, date)
-- PK. Topic-channel videos are included only if they're actually ingested into
-- dim_video; otherwise this naturally returns owned anchors only.
CREATE OR REPLACE FUNCTION select_ugc_anchors(p_min_views bigint, p_max_anchors int)
RETURNS TABLE (video_id text, company text, source_kind text, latest_views bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (fvd.video_id) fvd.video_id, fvd.views
    FROM fct_video_daily fvd
    ORDER BY fvd.video_id, fvd.date DESC
  )
  SELECT v.video_id, c.company, c.channel_type AS source_kind, l.views AS latest_views
  FROM dim_video v
  JOIN dim_channel c ON c.channel_id = v.channel_id
  JOIN latest l ON l.video_id = v.video_id
  WHERE v.is_short = false
    AND c.is_active = true
    AND c.channel_type IN ('owned', 'topic')
    AND l.views >= p_min_views
  ORDER BY l.views DESC
  LIMIT p_max_anchors;
$$;

REVOKE ALL ON FUNCTION select_ugc_anchors(bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION select_ugc_anchors(bigint, int) FROM anon, authenticated;
