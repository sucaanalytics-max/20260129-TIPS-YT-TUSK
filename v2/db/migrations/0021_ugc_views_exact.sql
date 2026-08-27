-- =============================================================================
-- Tusk YT v2 — Exact UGC view counts (A1)
--
-- The weekly UGC cron parses view counts from Shorts-pivot accessibility text
-- ("1.9K views" → 1900) into fct_ugc_short_match.view_count — approximate. The
-- videos.list enrichment (dim_ugc_video.latest_view_count) holds the PRECISE
-- count. Backfilling that onto each per-snapshot row used to require hundreds
-- of individual UPDATEs per run (too slow under the 300s function cap), so it
-- was deliberately skipped (see app/api/cron/ugc-discovery/route.ts).
--
-- This migration adds a `views_exact` column and a SET-based bulk-update
-- function so the cron can push all precise counts for a snapshot date in a
-- SINGLE round-trip via jsonb_to_recordset.
-- =============================================================================

ALTER TABLE fct_ugc_short_match
  ADD COLUMN IF NOT EXISTS views_exact bigint;

COMMENT ON COLUMN fct_ugc_short_match.views_exact IS
  'Precise cumulative views from videos.list (vs approximate view_count parsed from accessibility text). NULL until enrichment resolves it.';

-- Bulk-update views_exact for one snapshot date from a jsonb array of
-- {ugc_video_id, views} objects. One set-based statement — replaces N UPDATEs.
-- SECURITY DEFINER + locked search_path so it runs with the owner's rights
-- regardless of caller; the cron invokes it via the service-role key.
CREATE OR REPLACE FUNCTION update_ugc_views_exact(p_asof date, p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE fct_ugc_short_match f
     SET views_exact = r.views
    FROM jsonb_to_recordset(p_rows) AS r(ugc_video_id text, views bigint)
   WHERE f.ugc_video_id = r.ugc_video_id
     AND f.asof = p_asof;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Lock down: only the service role (which bypasses RLS) should call this.
REVOKE ALL ON FUNCTION update_ugc_views_exact(date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_ugc_views_exact(date, jsonb) FROM anon, authenticated;
