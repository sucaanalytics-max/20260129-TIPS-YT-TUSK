-- Migration 004: Add CHECK constraints to prevent invalid data at the database level
--
-- These constraints act as a last line of defense. The cron jobs now validate
-- data before insert, but CHECK constraints catch anything that slips through.
--
-- Run AFTER migration 003 (which deletes existing invalid rows).
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/bfafqccvzboyfjewzvhk/sql

-- YouTube: daily_views must be NULL (no data) or positive and < 200M
ALTER TABLE youtube_channel_stats
    ADD CONSTRAINT chk_daily_views_valid
    CHECK (daily_views IS NULL OR (daily_views > 0 AND daily_views < 200000000));

-- YouTube: daily_subscribers can be negative (lost subs) but within reason
ALTER TABLE youtube_channel_stats
    ADD CONSTRAINT chk_daily_subs_valid
    CHECK (daily_subscribers IS NULL OR daily_subscribers BETWEEN -100000 AND 1000000);

-- Stock: close price must be positive
ALTER TABLE stock_prices
    ADD CONSTRAINT chk_close_positive
    CHECK (close > 0);

-- Stock: high >= low when both are present
ALTER TABLE stock_prices
    ADD CONSTRAINT chk_ohlc_valid
    CHECK (high IS NULL OR low IS NULL OR high >= low);
