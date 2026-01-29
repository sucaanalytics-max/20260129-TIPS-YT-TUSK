export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    try {
        const SUPABASE_URL = 'https://bfafqccvzboyfjewzvhk.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmYWZxY2N2emJveWZqZXd6dmhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU5ODE1MjIsImV4cCI6MjA1MTU1NzUyMn0.5vIXqHjZj_2rZBHx0xWKEZm9TaV5k7PL8HH9fqMqgG8';
        
        const startDate = req.query.start || '2026-01-09';
        const endDate = req.query.end || new Date().toISOString().split('T')[0];
        
        // Fetch from Yahoo Finance
        const symbol = 'TIPSMUSIC.NS';
        const start = Math.floor(new Date(startDate).getTime() / 1000);
        const end = Math.floor(new Date(endDate).getTime() / 1000);
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d`;
        
        const yahooResponse = await fetch(yahooUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const yahooData = await yahooResponse.json();
        const result = yahooData.chart?.result?.[0];
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'No data from Yahoo Finance',
                yahooUrl
            });
        }
        
        const timestamps = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        
        // Build records array
        const records = [];
        for (let i = 0; i < timestamps.length; i++) {
            const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
            if (quotes.close?.[i]) {
                records.push({
                    symbol: 'TIPSMUSIC',
                    date: date,
                    open: quotes.open?.[i] || 0,
                    high: quotes.high?.[i] || 0,
                    low: quotes.low?.[i] || 0,
                    close: quotes.close?.[i] || 0,
                    volume: quotes.volume?.[i] || 0
                });
            }
        }
        
        // Insert into Supabase
        let successCount = 0;
        let failCount = 0;
        const details = [];
        
        for (const record of records) {
            try {
                const response = await fetch(`${SUPABASE_URL}/rest/v1/stock_prices`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(record)
                });
                
                if (response.ok) {
                    successCount++;
                    details.push({ date: record.date, close: record.close, status: '✅' });
                } else {
                    failCount++;
                    details.push({ date: record.date, status: '❌', error: await response.text() });
                }
            } catch (error) {
                failCount++;
                details.push({ date: record.date, status: '❌', error: error.message });
            }
        }
        
        return res.status(200).json({
            success: true,
            message: 'Backfill completed',
            symbol: 'TIPSMUSIC',
            dateRange: { start: startDate, end: endDate },
            summary: {
                total: records.length,
                successful: successCount,
                failed: failCount
            },
            records: details
        });
        
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
}
