-- =============================================================================
-- Tusk YT v2 — raw-data depth migration
--
-- Adds video-level topic + live-streaming metadata, plus a per-channel
-- SocialBlade snapshot fact table for growth windows, ranks, and grades.
--
-- All changes are additive. No destructive operations.
-- =============================================================================

-- ---- dim_video: topic + live-stream metadata --------------------------------
-- topic_ids:        raw YT topic entity IDs (e.g. '/m/04rlf' = Music,
--                   '/m/06m8wmm' = Arijit Singh). Opaque hex IDs; some map to
--                   genres, some to artists/films/events.
-- topic_categories: Wikipedia URLs (e.g. 'https://en.wikipedia.org/wiki/Music').
--                   YT-curated high-level taxonomy. Human-readable directly.
-- is_live + times:  populated from videos.list?part=liveStreamingDetails.
--                   actual_start_time IS NOT NULL ↔ broadcast happened (live or
--                   premiere). peak_concurrent_viewers is the max value seen.

ALTER TABLE dim_video
  ADD COLUMN IF NOT EXISTS topic_ids               text[],
  ADD COLUMN IF NOT EXISTS topic_categories        text[],
  ADD COLUMN IF NOT EXISTS is_live                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_start_time       timestamptz,
  ADD COLUMN IF NOT EXISTS actual_end_time         timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_start_time    timestamptz,
  ADD COLUMN IF NOT EXISTS peak_concurrent_viewers int,
  ADD COLUMN IF NOT EXISTS made_for_kids           boolean;

CREATE INDEX IF NOT EXISTS idx_dim_video_topic_categories_gin
  ON dim_video USING gin (topic_categories);
CREATE INDEX IF NOT EXISTS idx_dim_video_topic_ids_gin
  ON dim_video USING gin (topic_ids);
CREATE INDEX IF NOT EXISTS idx_dim_video_is_live
  ON dim_video (is_live) WHERE is_live = true;
CREATE INDEX IF NOT EXISTS idx_dim_video_actual_start
  ON dim_video (actual_start_time DESC) WHERE actual_start_time IS NOT NULL;

-- ---- dim_channel: status flags for context ----------------------------------
ALTER TABLE dim_channel
  ADD COLUMN IF NOT EXISTS made_for_kids   boolean,
  ADD COLUMN IF NOT EXISTS privacy_status  text;

-- ---- fct_channel_sb_snapshot: SocialBlade per-channel time-series -----------
-- One row per (channel_id, asof). Asof is the date the SB cron ran.
-- Growth windows are SB-published deltas; ranks are SB-global at that point.
CREATE TABLE IF NOT EXISTS fct_channel_sb_snapshot (
  channel_id          text NOT NULL REFERENCES dim_channel(channel_id),
  asof                date NOT NULL,
  -- Growth windows (sub-count delta over N days, as published by SB)
  subs_growth_1       bigint,
  subs_growth_3       bigint,
  subs_growth_7       bigint,
  subs_growth_14      bigint,
  subs_growth_30      bigint,
  subs_growth_60      bigint,
  subs_growth_90      bigint,
  subs_growth_180     bigint,
  subs_growth_365     bigint,
  -- Growth windows (view-count delta over N days, as published by SB)
  views_growth_1      bigint,
  views_growth_3      bigint,
  views_growth_7      bigint,
  views_growth_14     bigint,
  views_growth_30     bigint,
  views_growth_60     bigint,
  views_growth_90     bigint,
  views_growth_180    bigint,
  views_growth_365    bigint,
  -- Ranks (SB-global; nullable when SB doesn't expose for a category)
  sb_rank             int,
  subs_rank           int,
  views_rank          int,
  country_rank        int,
  channel_type_rank   int,
  -- Quality + compliance signals
  grade               text,
  sb_verified         boolean,
  made_for_kids       boolean,
  -- Totals at snapshot (cross-check vs our own fct_channel_daily for the same date)
  total_subscribers   bigint,
  total_views         bigint,
  total_uploads       int,
  -- Audit
  ingest_run_id       bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, asof)
);

CREATE INDEX IF NOT EXISTS idx_fct_channel_sb_snapshot_asof
  ON fct_channel_sb_snapshot (asof DESC);

ALTER TABLE fct_channel_sb_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_channel_sb_snapshot FROM anon, authenticated;
