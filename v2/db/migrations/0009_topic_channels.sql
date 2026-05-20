-- =============================================================================
-- Tusk YT v2 — Topic channels support
--
-- YouTube auto-generates per-artist "Topic" channels (e.g. "Arijit Singh - Topic")
-- that aggregate the audio-only versions of every track in the catalog. These
-- are a second revenue leg for the label — currently uncaptured because our
-- ingest only walks owned channels.
--
-- This migration is additive:
--   - channel_type:  'owned' | 'topic' | 'related' — discriminator for queries
--   - artist_name:   which artist this Topic channel represents (NULL for owned)
--   - ingest_videos: opt-out flag — Topic channels contain hundreds of
--                    auto-generated audio tracks we don't want walking individually
--   - dim_channel.company is made nullable because Topic channels semantically
--     aggregate across labels (an artist's catalog is split across many labels).
--     Attribution is handled separately via dim_artist_label below.
--
-- dim_artist_label maps each artist to one or more labels with catalog_share
-- weights (0..1). Queries that want "TIPSMUSIC's catalog reach via Topics"
-- multiply Topic channel daily views by the artist's catalog_share for TIPS.
-- =============================================================================

ALTER TABLE dim_channel
  ADD COLUMN IF NOT EXISTS channel_type    text NOT NULL DEFAULT 'owned',
  ADD COLUMN IF NOT EXISTS artist_name     text,
  ADD COLUMN IF NOT EXISTS ingest_videos   boolean NOT NULL DEFAULT true;

ALTER TABLE dim_channel
  ALTER COLUMN company DROP NOT NULL;

ALTER TABLE dim_channel
  DROP CONSTRAINT IF EXISTS dim_channel_channel_type_chk;
ALTER TABLE dim_channel
  ADD CONSTRAINT dim_channel_channel_type_chk
  CHECK (channel_type IN ('owned', 'topic', 'related'));

CREATE INDEX IF NOT EXISTS idx_dim_channel_channel_type
  ON dim_channel (channel_type) WHERE channel_type <> 'owned';

CREATE INDEX IF NOT EXISTS idx_dim_channel_artist_name
  ON dim_channel (artist_name) WHERE artist_name IS NOT NULL;

-- Per-artist label attribution. A single artist can have catalog across
-- multiple labels (Arijit Singh is on TIPS, Saregama, and many others) — we
-- store a soft weight rather than a hard mapping.
CREATE TABLE IF NOT EXISTS dim_artist_label (
  artist_name   text NOT NULL,
  company       text NOT NULL REFERENCES dim_company(company),
  catalog_share numeric NOT NULL DEFAULT 1.0 CHECK (catalog_share BETWEEN 0 AND 1),
  notes         text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_name, company)
);

CREATE INDEX IF NOT EXISTS idx_dim_artist_label_company
  ON dim_artist_label (company);

ALTER TABLE dim_artist_label ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dim_artist_label FROM anon, authenticated;
