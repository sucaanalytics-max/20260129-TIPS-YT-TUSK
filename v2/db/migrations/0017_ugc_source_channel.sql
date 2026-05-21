-- =============================================================================
-- Tusk YT v2 — UGC attribution: source-audio channel resolution
--
-- The music panel exposes attribution_source_video_id (the master-audio
-- video that YT's Content ID matched against). That video is almost never
-- in our dim_video table — masters live on Topic channels, audio-only
-- sub-label channels, or per-film soundtrack channels that aren't part
-- of our 39 owned-channel set.
--
-- This migration adds the resolved channel info so we can determine
-- ownership downstream:
--   - attribution_source_channel_id: from videos.list snippet.channelId
--   - attribution_source_channel_name: snippet.channelTitle
--
-- The catalog-match determination is then a JOIN against dim_channel:
--   - If the source channel is in dim_channel.channel_type IN ('owned','topic')
--     and matches the anchor's company → confirmed Content ID on OUR catalog
--   - Otherwise → Content ID exists but masters live elsewhere (still
--     possibly our label via an untracked sub-channel)
-- =============================================================================

ALTER TABLE dim_ugc_video
  ADD COLUMN IF NOT EXISTS attribution_source_channel_id    text,
  ADD COLUMN IF NOT EXISTS attribution_source_channel_name  text;

CREATE INDEX IF NOT EXISTS idx_dim_ugc_video_source_channel
  ON dim_ugc_video (attribution_source_channel_id)
  WHERE attribution_source_channel_id IS NOT NULL;
