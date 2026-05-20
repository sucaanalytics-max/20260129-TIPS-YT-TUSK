-- =============================================================================
-- Tusk YT v2 — Video engagement deltas (likes + comments)
--
-- The videos cron already stores cumulative `likes` and `comments` per
-- (video, date). It computes `daily_views` delta but never computed the
-- like/comment deltas. Engagement deltas are a missing signal dimension:
--
--   - Like rate per view per day → content-quality proxy
--   - Comment velocity → fandom/anger intensity proxy
--   - Negative deltas (allowed for likes/comments — moderation events)
--
-- This migration is purely additive. Existing rows get NULL deltas; the
-- next cron run starts populating them via prior-row lookback (same
-- pattern as daily_views).
-- =============================================================================

ALTER TABLE fct_video_daily
  ADD COLUMN IF NOT EXISTS daily_likes    int,
  ADD COLUMN IF NOT EXISTS daily_comments int;
