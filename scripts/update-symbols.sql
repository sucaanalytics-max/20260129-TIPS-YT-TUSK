-- Standardize all symbol names to TIPSMUSIC
UPDATE stock_prices 
SET symbol = 'TIPSMUSIC' 
WHERE symbol = 'TIPSINDLTD';

-- Verify the update
SELECT 
    symbol, 
    COUNT(*) as total_records,
    MIN(date) as earliest_date,
    MAX(date) as latest_date,
    MIN(close) as lowest_price,
    MAX(close) as highest_price
FROM stock_prices
GROUP BY symbol
ORDER BY symbol;

-- Check for any missing dates in January 2026
SELECT 
    date,
    close,
    volume
FROM stock_prices
WHERE symbol = 'TIPSMUSIC'
  AND date >= '2026-01-01'
ORDER BY date DESC;
