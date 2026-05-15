-- =============================================================================
-- Tusk YT v2 — MV refresh helpers
--
-- supabase-py can't run raw SQL; it can only call RPCs. This migration adds a
-- SECURITY DEFINER function the Python stats service uses to refresh
-- fct_returns_daily before reading it.
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_fct_returns()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  REFRESH MATERIALIZED VIEW fct_returns_daily;
$$;

REVOKE EXECUTE ON FUNCTION refresh_fct_returns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_fct_returns() TO service_role;
