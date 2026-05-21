-- =============================================================================
-- Tusk YT v2 — UGC enrichment (I1 + I2 + I3)
--
-- Phase 1 stored per-snapshot rows in fct_ugc_short_match with approximate
-- view counts parsed from accessibility text and no channel attribution.
-- This migration adds the enrichment layer:
--
-- I1 (videos.list enrichment): dim_ugc_video deduplicates UGC video metadata
--   across snapshots and stores precise channel_id + channelTitle + exact
--   view/like/comment counts + licensedContent flag from videos.list.
--
-- I2 (first/last seen): naturally derivable via MIN/MAX(asof) GROUP BY
--   ugc_video_id on fct_ugc_short_match. No schema change; a query helper
--   in queries.ts will surface it.
--
-- I3 (Content-ID claim verification): watch-page music panel attribution.
--   Stored on dim_ugc_video as attribution_label / attribution_kind /
--   attribution_checked_at so we don't re-scrape unnecessarily.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dim_ugc_video (
  ugc_video_id          text PRIMARY KEY,
  channel_id            text,
  channel_name          text,
  title                 text,
  description           text,
  published_at          timestamptz,
  duration_seconds      int,
  is_short              boolean,
  -- contentDetails.licensedContent: true if the video has been claimed by
  -- a Content ID partner (any partner, not necessarily our label).
  licensed_content      boolean,
  -- Latest cumulative stats from videos.list. Per-snapshot deltas continue
  -- to live in fct_ugc_short_match (view_count column there is the
  -- accessibility-parsed approximate; views_exact added below is the
  -- precise per-snapshot value).
  latest_view_count     bigint,
  latest_like_count     int,
  latest_comment_count  int,
  -- I3: music-panel-derived attribution. Populated by a sampled scrape of
  -- high-view UGC. attribution_kind is one of:
  --   'content_id' — watch page music panel surfaces an explicit
  --                  "Licensed to YouTube by ..." claim
  --   'sound_ref'  — UGC uses the source's audio via Shorts sound system
  --                  (no music panel; attribution lives in YT's CMS only)
  --   'none'       — neither panel nor sound link (rare; usually means
  --                  the audio match has degraded or video was edited)
  --   'unknown'    — not yet scraped
  attribution_label     text,
  attribution_kind      text,
  attribution_checked_at timestamptz,
  -- Audit
  enriched_at           timestamptz,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  meta                  jsonb
);

CREATE INDEX IF NOT EXISTS idx_dim_ugc_video_channel
  ON dim_ugc_video (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dim_ugc_video_attribution_kind
  ON dim_ugc_video (attribution_kind);

ALTER TABLE dim_ugc_video ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dim_ugc_video FROM anon, authenticated;

-- Per-snapshot exact view count (in addition to the text-parsed approximate
-- view_count column already present from migration 0014).
ALTER TABLE fct_ugc_short_match
  ADD COLUMN IF NOT EXISTS views_exact bigint;
