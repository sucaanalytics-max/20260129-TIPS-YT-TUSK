-- =============================================================================
-- Tusk YT v2 — UGC Phase 1: Shorts pivot snapshot
--
-- For each "anchor" catalog track (top-N most-viewed videos per company), we
-- weekly scrape youtube.com/source/{video_id}/shorts to enumerate the Shorts
-- using that audio as their sound. Each Short found = third-party UGC using
-- the label's audio asset.
--
-- This is a *proxy* for Content ID match data (which is only accessible via
-- CMS API, requiring label cooperation). YT's source-pivot page returns at
-- most a few hundred lockups per sound — a sampled view, not a complete
-- enumeration. But it's free, scriptable, and produces a directional UGC
-- reach signal we can track week-over-week.
--
-- Wide-form time-series table: one row per (source, ugc, asof) so we can
-- track when each UGC entered the pivot list and how its view count grows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_ugc_short_match (
  source_video_id  text NOT NULL REFERENCES dim_video(video_id),
  ugc_video_id     text NOT NULL,
  asof             date NOT NULL,
  -- Parsed from accessibilityText on the pivot lockup. Approximate
  -- (e.g. "1.9K views" → 1900). Raw text retained for debugging.
  view_count       bigint,
  view_count_text  text,
  -- Pivot lockup doesn't expose channel_id; only the channel name appears
  -- in the accessibility text. Captured as-text for now; enrichment via
  -- a follow-up videos.list batch can resolve to channel_id later.
  channel_name     text,
  raw_meta         jsonb,
  ingest_run_id    bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_video_id, ugc_video_id, asof)
);

CREATE INDEX IF NOT EXISTS idx_fct_ugc_short_match_asof
  ON fct_ugc_short_match (asof DESC);
CREATE INDEX IF NOT EXISTS idx_fct_ugc_short_match_source
  ON fct_ugc_short_match (source_video_id, asof DESC);
CREATE INDEX IF NOT EXISTS idx_fct_ugc_short_match_ugc
  ON fct_ugc_short_match (ugc_video_id);

ALTER TABLE fct_ugc_short_match ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_ugc_short_match FROM anon, authenticated;
