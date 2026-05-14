-- Migration 006: Ensure error_logs exists and is locked down (service_role only)
--
-- Background:
--   Audit of the live DB (project bfafqccvzboyfjewzvhk) revealed that the
--   error_logs table was never actually created — migration 005 had not been
--   applied. As a result, every `supabase.from('error_logs').insert(...)` in
--   the cron handlers silently failed inside its try/catch, and no operational
--   errors were ever logged.
--
--   schema.sql (legacy bootstrap) had two contradictory facts on this table:
--     1. CREATE TABLE IF NOT EXISTS error_logs (...)
--     2. CREATE POLICY "Enable read access for all users" ON error_logs
--        FOR SELECT USING (true);
--   Combined with the anon key embedded in index.html, this would have made
--   every stack trace publicly readable — *if* the table had existed.
--
-- This migration:
--   1. Creates error_logs with the same shape as migration 005 (idempotent).
--   2. Ensures RLS is enabled.
--   3. Drops any open-read policy if it exists from a prior schema.sql run.
--   4. Revokes anon/authenticated SELECT (defense-in-depth alongside RLS).
--   5. Service-role keys bypass RLS and continue to work for cron writes
--      and /api/health reads.
--
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS error_logs (
    id             BIGSERIAL PRIMARY KEY,
    error_type     VARCHAR(100) NOT NULL,
    error_message  TEXT NOT NULL,
    error_details  JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_type_created
    ON error_logs(error_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
    ON error_logs(created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Drop any open-read policy created by an older schema.sql run.
DROP POLICY IF EXISTS "Enable read access for all users" ON error_logs;
DROP POLICY IF EXISTS "public read" ON error_logs;

-- Defense in depth: even with no RLS policy granting SELECT, revoke direct grants.
REVOKE SELECT ON error_logs FROM anon;
REVOKE SELECT ON error_logs FROM authenticated;

-- Verify
DO $$
DECLARE
  policy_count INT;
  rls_on       BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'error_logs';

  SELECT relrowsecurity INTO rls_on
  FROM pg_class
  WHERE relname = 'error_logs' AND relnamespace = 'public'::regnamespace;

  RAISE NOTICE 'error_logs: rls_enabled=%, policy_count=% (0 + RLS = effectively service_role only)', rls_on, policy_count;
END $$;
