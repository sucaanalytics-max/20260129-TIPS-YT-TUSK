-- =============================================================================
-- Tusk YT v2 — dim_channel.meta
--
-- Adds a free-form jsonb metadata column so we can tag genre/kind (devotional,
-- films, karaoke, kids, etc.) without polluting the language column. Used
-- initially by the Saregama Carvaan + taxonomy backfill in /api/cron/seed.
-- The query layer ignores meta until a feature consumes it.
-- =============================================================================

ALTER TABLE dim_channel
  ADD COLUMN IF NOT EXISTS meta jsonb;

CREATE INDEX IF NOT EXISTS idx_dim_channel_meta_gin
  ON dim_channel USING gin (meta);
