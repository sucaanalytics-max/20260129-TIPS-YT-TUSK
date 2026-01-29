import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmYWZxY2N2emJveWZqZXd6dmhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc1MjYxNzAsImV4cCI6MjA1MzEwMjE3MH0.0EYg4KZP_rrABx0zk6xECZAh-JWG_4qJy5nJWqYOQhU';

const CORRECT_SYMBOL = 'TIPSMUSIC';

export default async function handler(req, res) {
    console.log('🚀 Starting stock price update for TIPSMUSIC...');
    
    try {
        const stockPrice = await fetchNSEPrice(CORRECT_SYMBOL);
        
        if (!stockPrice || stockPrice.close === 0) {
            throw new Error('Failed to fetch valid stock price');
        }
        
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const today = new Date().toISOString().split('T')[0];
        
        // Upsert (insert or update)
        const { data, error } = await supabase
            .from('stock_prices')
            .upsert({
                symbol: CORRECT_SYMBOL,
                date: today,
                open: stockPrice.open,
                high: stockPrice.high,
                low: stockPrice.low,
                close: stockPrice.close,
                volume: stockPrice.volume,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'symbol,date'
            })
            .select();
        
        if (error) throw error;
        
        console.log(`✅ Stock price updated for ${today}: ₹${stockPrice.close}`);
        
        return res.status(200).json({
            success: true,
            message: 'Stock price updated successfully',
            symbol: CORRECT_SYMBOL,
            date: today,
            data: {
                open: stockPrice.open,
                high: stockPrice.high,
                low: stockPrice.low,
                close: stockPrice.close,
                volume: stockPrice.volume
            }
        });
        
    } catch (error) {
        console.error('❌ Error updating stock price:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

async function fetchNSEPrice(symbol) {
    console.log(`Fetching price for ${symbol}...`);
    
    try {
        // Try Yahoo Finance (most reliable)
        const yahooSymbol = `${symbol}.NS`;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Yahoo Finance API returned ${response.status}`);
        }
        
        const data = await response.json();
        const quote = data.chart?.result?.[0];
        
        if (!quote) {
            throw new Error('No data in Yahoo Finance response');
        }
        
        const meta = quote.meta;
        const indicators = quote.indicators?.quote?.[0];
        
        const price = {
            open: indicators?.open?.[0] || meta.previousClose || meta.regularMarketPrice,
            high: indicators?.high?.[0] || meta.regularMarketPrice,
            low: indicators?.low?.[0] || meta.regularMarketPrice,
            close: meta.regularMarketPrice || meta.previousClose || 0,
            volume: indicators?.volume?.[0] || 0
        };
        
        console.log(`✅ Fetched price: ₹${price.close}`);
        return price;
        
    } catch (error) {
        console.error('Error fetching from Yahoo Finance:', error);
        
        // Fallback to NSE India
        try {
            console.log('Trying NSE India API...');
            const nseUrl = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;
            
            const response = await fetch(nseUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            });
            
            if (!response.ok) throw new Error('NSE API failed');
            
            const data = await response.json();
            
            return {
                open: data.priceInfo?.open || 0,
                high: data.priceInfo?.intraDayHighLow?.max || 0,
                low: data.priceInfo?.intraDayHighLow?.min || 0,
                close: data.priceInfo?.lastPrice || 0,
                volume: data.priceInfo?.totalTradedVolume || 0
            };
            
        } catch (nseError) {
            console.error('NSE API also failed:', nseError);
            return null;
        }
    }
}
