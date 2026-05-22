-- =============================================================================
-- Tusk YT v2 — UGC creator geographic enrichment
--
-- For each UGC video we already store dim_ugc_video.channel_id (the
-- creator). To compute diaspora-vs-domestic UGC reach we need the
-- channel's country. YT's channels.list?part=snippet returns `country`
-- as a two-letter ISO code (when the creator set it). Storing on
-- dim_ugc_video so a single creator's country resolves once and is
-- reused across all their UGC matches.
--
-- Practical interpretation: 'IN' UGC = domestic, anything else (US, GB,
-- AE, CA, SA, etc.) = Indian-diaspora consumer market. Both still pay
-- the label royalties but ad CPMs differ — US/UK CPMs are several×
-- higher than IN, so heavy diaspora UGC is more valuable per view.
--
-- creator_country_checked_at lets us TTL the lookup (most channels'
-- country setting changes rarely; weekly re-check is plenty).
-- =============================================================================

ALTER TABLE dim_ugc_video
  ADD COLUMN IF NOT EXISTS creator_country             text,
  ADD COLUMN IF NOT EXISTS creator_country_checked_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_dim_ugc_video_creator_country
  ON dim_ugc_video (creator_country) WHERE creator_country IS NOT NULL;
