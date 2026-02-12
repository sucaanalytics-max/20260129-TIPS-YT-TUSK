import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const STOCK_SYMBOL = 'SAREGAMA';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check authorization
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');

  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authorization'
    });
  }

  console.log('🚀 Starting stock price update for SAREGAMA...');

  try {
    const stockPrice = await fetchNSEPrice(STOCK_SYMBOL);

    if (!stockPrice || stockPrice.close === 0) {
      throw new Error('Failed to fetch valid stock price');
    }

    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_KEY environment variable not set');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const today = new Date().toISOString().split('T')[0];

    // Upsert (insert or update)
    const { data, error } = await supabase
      .from('stock_prices')
      .upsert({
        symbol: STOCK_SYMBOL,
        date: today,
        open: stockPrice.open,
        high: stockPrice.high,
        low: stockPrice.low,
        close: stockPrice.close,
        volume: stockPrice.volume,
        source: stockPrice.source || 'yahoo_finance',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'symbol,date'
      })
      .select();

    if (error) throw error;

    console.log(`✅ Stock price updated for ${today}: ₹${stockPrice.close}`);

    return res.status(200).json({
      success: true,
      action: 'upserted',
      stockData: {
        symbol: STOCK_SYMBOL,
        date: today,
        open: stockPrice.open,
        high: stockPrice.high,
        low: stockPrice.low,
        close: stockPrice.close,
        volume: stockPrice.volume,
        source: stockPrice.source
      }
    });

  } catch (error) {
    console.error('❌ Error updating stock price:', error);

    // Log error to database if possible
    try {
      if (SUPABASE_SERVICE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        await supabase.from('error_logs').insert([{
          error_type: 'stock_update_failed',
          error_message: error.message,
          error_details: {
            stack: error.stack,
            symbol: STOCK_SYMBOL,
            timestamp: new Date().toISOString()
          }
        }]);
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
      volume: indicators?.volume?.[0] || 0,
      source: 'yahoo_finance'
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
        volume: data.priceInfo?.totalTradedVolume || 0,
        source: 'nse_india'
      };

    } catch (nseError) {
      console.error('NSE API also failed:', nseError);
      throw new Error('All stock price sources failed');
    }
  }
}
