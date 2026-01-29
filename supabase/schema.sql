-- SQL Schema for Stock Prices and Error Logging
-- This version handles existing tables and adds missing columns

-- ========================================
-- PART 1: CREATE OR ALTER STOCK_PRICES TABLE
-- ========================================

-- First, check if the table exists and create if it doesn't
CREATE TABLE IF NOT EXISTS stock_prices (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    open DECIMAL(10, 2),
    high DECIMAL(10, 2),
    low DECIMAL(10, 2),
    close DECIMAL(10, 2) NOT NULL,
    volume BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns if they don't exist (safe to run multiple times)
DO $$ 
BEGIN
    -- Add source column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'source'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
    END IF;
    
    -- Add open column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'open'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN open DECIMAL(10, 2);
    END IF;
    
    -- Add high column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'high'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN high DECIMAL(10, 2);
    END IF;
    
    -- Add low column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'low'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN low DECIMAL(10, 2);
    END IF;
    
    -- Add volume column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'volume'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN volume BIGINT DEFAULT 0;
    END IF;
    
    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_prices' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE stock_prices ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
END $$;

-- Create indexes for faster queries (if they don't exist)
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

-- Index for error log queries
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type);

-- ========================================
-- PART 3: ROW LEVEL SECURITY (RLS)
-- ========================================

-- Enable RLS if not already enabled
ALTER TABLE stock_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DO $$ 
BEGIN
    -- Drop and recreate stock_prices read policy
    DROP POLICY IF EXISTS "Enable read access for all users" ON stock_prices;
    CREATE POLICY "Enable read access for all users" ON stock_prices
        FOR SELECT USING (true);
    
    -- Drop and recreate error_logs read policy
    DROP POLICY IF EXISTS "Enable read access for all users" ON error_logs;
    CREATE POLICY "Enable read access for all users" ON error_logs
        FOR SELECT USING (true);
END $$;

-- ========================================
-- PART 4: HELPER VIEWS AND FUNCTIONS
-- ========================================

-- Drop existing view if it exists
DROP VIEW IF EXISTS latest_stock_prices;

-- Create view for latest stock prices
CREATE VIEW latest_stock_prices AS
SELECT 
    date,
    close,
    (close - LAG(close) OVER (ORDER BY date)) AS daily_change,
    CASE 
        WHEN LAG(close) OVER (ORDER BY date) > 0 
        THEN ((close - LAG(close) OVER (ORDER BY date)) / LAG(close) OVER (ORDER BY date) * 100)
        ELSE 0 
    END AS daily_change_percent,
    volume,
    COALESCE(source, 'manual') as source,
    updated_at
FROM stock_prices
ORDER BY date DESC
LIMIT 30;

-- Grant access to the view
GRANT SELECT ON latest_stock_prices TO anon, authenticated;

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_stock_price_for_date(DATE);

-- Function to get stock price for a specific date (with forward fill)
CREATE OR REPLACE FUNCTION get_stock_price_for_date(target_date DATE)
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
    WHERE sp.date <= target_date
    ORDER BY sp.date DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- PART 5: UPDATE EXISTING DATA
-- ========================================

-- Update any existing rows that have NULL in the new columns
UPDATE stock_prices 
SET source = 'historical' 
WHERE source IS NULL;

-- Set updated_at to created_at for existing rows if updated_at is NULL
UPDATE stock_prices 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- ========================================
-- PART 6: VERIFY SETUP
-- ========================================

-- Show table structure
DO $$ 
DECLARE
    column_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns 
    WHERE table_name = 'stock_prices';
    
    RAISE NOTICE 'Stock Prices Table Setup Complete!';
    RAISE NOTICE 'Total columns: %', column_count;
END $$;

-- Comments for documentation
COMMENT ON TABLE stock_prices IS 'Daily stock prices for TIPSMUSIC (NSE) - Updated by automated cron job';
COMMENT ON TABLE error_logs IS 'Error logs for monitoring automated updates';
COMMENT ON COLUMN stock_prices.source IS 'Data source: yahoo_finance, alpha_vantage, twelve_data, manual, or historical';
COMMENT ON COLUMN stock_prices.date IS 'Trading date (YYYY-MM-DD)';
COMMENT ON COLUMN stock_prices.close IS 'Closing price for the day';
COMMENT ON COLUMN stock_prices.volume IS 'Trading volume';

-- Final success message
DO $$ 
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Database schema setup completed successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Tables created/updated:';
    RAISE NOTICE '  ✓ stock_prices (with all required columns)';
    RAISE NOTICE '  ✓ error_logs';
    RAISE NOTICE 'Views created:';
    RAISE NOTICE '  ✓ latest_stock_prices';
    RAISE NOTICE 'Functions created:';
    RAISE NOTICE '  ✓ get_stock_price_for_date()';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Ready for automated stock price updates!';
    RAISE NOTICE '========================================';
END $$;
