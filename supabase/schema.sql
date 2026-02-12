-- SQL Schema for Multi-Company Stock Prices and Error Logging
-- Supports: TIPSMUSIC, SAREGAMA (and future companies)

-- ========================================
-- PART 1: CREATE OR ALTER STOCK_PRICES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS stock_prices (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL DEFAULT 'TIPSMUSIC',
    date DATE NOT NULL,
    open DECIMAL(10, 2),
    high DECIMAL(10, 2),
    low DECIMAL(10, 2),
    close DECIMAL(10, 2) NOT NULL,
    volume BIGINT DEFAULT 0,
    source VARCHAR(50) DEFAULT 'manual',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(symbol, date)
);

-- Add missing columns if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'symbol'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN symbol VARCHAR(50) NOT NULL DEFAULT 'TIPSMUSIC';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'source'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'open'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN open DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'high'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN high DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'low'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN low DECIMAL(10, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'volume'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN volume BIGINT DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_prices' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_stock_prices_symbol_date ON stock_prices(symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_prices_date ON stock_prices(date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_prices_created_at ON stock_prices(created_at DESC);

-- ========================================
-- PART 2: CREATE ERROR_LOGS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS error_logs (
    id BIGSERIAL PRIMARY KEY,
    error_type VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type);

-- ========================================
-- PART 3: ROW LEVEL SECURITY (RLS)
-- ========================================

ALTER TABLE stock_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Enable read access for all users" ON stock_prices;
    CREATE POLICY "Enable read access for all users" ON stock_prices
        FOR SELECT USING (true);

    DROP POLICY IF EXISTS "Enable read access for all users" ON error_logs;
    CREATE POLICY "Enable read access for all users" ON error_logs
        FOR SELECT USING (true);
END $$;

-- ========================================
-- PART 4: HELPER VIEWS AND FUNCTIONS
-- ========================================

DROP VIEW IF EXISTS latest_stock_prices;

CREATE VIEW latest_stock_prices AS
SELECT
    symbol,
    date,
    open,
    high,
    low,
    close,
    (close - LAG(close) OVER (PARTITION BY symbol ORDER BY date)) AS daily_change,
    CASE
        WHEN LAG(close) OVER (PARTITION BY symbol ORDER BY date) > 0
        THEN ((close - LAG(close) OVER (PARTITION BY symbol ORDER BY date)) / LAG(close) OVER (PARTITION BY symbol ORDER BY date) * 100)
        ELSE 0
    END AS daily_change_percent,
    volume,
    COALESCE(source, 'manual') as source,
    updated_at
FROM stock_prices
ORDER BY symbol, date DESC;

GRANT SELECT ON latest_stock_prices TO anon, authenticated;

DROP FUNCTION IF EXISTS get_stock_price_for_date(VARCHAR, DATE);

CREATE OR REPLACE FUNCTION get_stock_price_for_date(target_symbol VARCHAR, target_date DATE)
RETURNS TABLE (
    date DATE,
    close DECIMAL(10, 2),
    is_filled BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        target_date as date,
        sp.close,
        (sp.date < target_date) as is_filled
    FROM stock_prices sp
    WHERE sp.symbol = target_symbol
      AND sp.date <= target_date
    ORDER BY sp.date DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- PART 5: DATA CLEANUP
-- ========================================

-- Standardize TIPSINDLTD entries to TIPSMUSIC
UPDATE stock_prices SET symbol = 'TIPSMUSIC' WHERE symbol = 'TIPSINDLTD';

UPDATE stock_prices SET source = 'historical' WHERE source IS NULL;
UPDATE stock_prices SET updated_at = created_at WHERE updated_at IS NULL;

-- ========================================
-- PART 6: VERIFY SETUP
-- ========================================

DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Database schema setup completed!';
    RAISE NOTICE '========================================';
    FOR rec IN
        SELECT symbol, COUNT(*) as cnt, MIN(date) as first_date, MAX(date) as last_date
        FROM stock_prices GROUP BY symbol ORDER BY symbol
    LOOP
        RAISE NOTICE 'Symbol: % | Records: % | Range: % to %', rec.symbol, rec.cnt, rec.first_date, rec.last_date;
    END LOOP;
    RAISE NOTICE '========================================';
END $$;

COMMENT ON TABLE stock_prices IS 'Daily stock prices for multiple companies (NSE) - Updated by automated cron job';
COMMENT ON TABLE error_logs IS 'Error logs for monitoring automated updates';
COMMENT ON COLUMN stock_prices.symbol IS 'Stock symbol: TIPSMUSIC, SAREGAMA, etc.';
COMMENT ON COLUMN stock_prices.source IS 'Data source: yahoo_finance, nse_india, manual, or historical';
