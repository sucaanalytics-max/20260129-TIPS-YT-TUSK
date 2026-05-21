-- =============================================================================
-- Tusk YT v2 — UGC attribution: modern panel shape
--
-- YouTube changed the watch-page "Music in this video" structure. The old
-- shape had infoRowRenderer rows including "Licensed to YouTube by ..."
-- which directly named the label. The new shape (videoAttributeViewModel)
-- exposes song + artist + a deep link to the SOURCE audio video, but
-- removes the explicit label attribution string entirely.
--
-- That trade is actually helpful: matching by source_video_id back into
-- dim_video is more reliable than pattern-matching label name strings.
-- The catalog-vs-other determination becomes a JOIN, not a substring
-- comparison.
-- =============================================================================

ALTER TABLE dim_ugc_video
  ADD COLUMN IF NOT EXISTS attribution_song              text,
  ADD COLUMN IF NOT EXISTS attribution_artist            text,
  ADD COLUMN IF NOT EXISTS attribution_source_video_id   text;

CREATE INDEX IF NOT EXISTS idx_dim_ugc_video_attribution_source
  ON dim_ugc_video (attribution_source_video_id)
  WHERE attribution_source_video_id IS NOT NULL;
