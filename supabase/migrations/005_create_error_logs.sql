-- ============================================================
-- Migration 005: Create error_logs table
-- Run in Supabase SQL editor
-- ============================================================
-- All 3 cron endpoints (update-youtube-stats, update-stock-price,
-- update-saregama-price) write to this table on failure.
-- Without it, errors are silently lost.

CREATE TABLE IF NOT EXISTS error_logs (
    id             BIGSERIAL PRIMARY KEY,
    error_type     VARCHAR(100) NOT NULL,
    error_message  TEXT NOT NULL,
    error_details  JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_type_created
    ON error_logs(error_type, created_at DESC);
