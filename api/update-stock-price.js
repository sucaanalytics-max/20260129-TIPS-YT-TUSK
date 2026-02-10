import { createClient } from '@supabase/supabase-js';

// CORRECT environment variable names matching Vercel setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use SERVICE_ROLE key from environment
const CRON_SECRET = process.env.CRON_SECRET;
const STOCK_SYMBOL = 'TIPSMUSIC';
const YAHOO_SYMBOL = 'TIPSINDLTD'; // Yahoo Finance uses TIPSINDLTD.NS for Tips Industries

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  // Handle OPTIONS request
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

  console.log('🚀 Starting stock price update for TIPSMUSIC...');
  
  try {
    // Fetch stock price using Yahoo Finance symbol
    const stockPrice = await fetchNSEPrice(YAHOO_SYMBOL);
    
    if (!stockPrice || stockPrice.close === 0) {
      throw new Error('Failed to fetch valid stock price');
    }

    // Check if we have Supabase credentials
    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_KEY environment variable not set');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const today = new Date().toISOString().split('T')[0];

    // Check if today's record exists
    const { data: existing, error: checkError } = await supabase
      .from('stock_prices')
      .select('*')
      .eq('symbol', STOCK_SYMBOL)
      .eq('date', today)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    let result;
    let action;

    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('stock_prices')
        .update({
          open: stockPrice.open,
          high: stockPrice.high,
          low: stockPrice.low,
          close: stockPrice.close,
          volume: stockPrice.volume,
          source: stockPrice.source,
          updated_at: new Date().toISOString()
        })
        .eq('symbol', STOCK_SYMBOL)
        .eq('date', today)
        .select();

      if (error) throw error;
      result = data[0];
      action = 'updated';
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('stock_prices')
        .insert([{
          symbol: STOCK_SYMBOL,
          date: today,
          open: stockPrice.open,
          high: stockPrice.high,
          low: stockPrice.low,
          close: stockPrice.close,
          volume: stockPrice.volume,
          source: stockPrice.source,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw error;
      result = data[0];
      action = 'inserted';
    }

    console.log(`✅ Stock price ${action} for ${today}: ₹${stockPrice.close}`);
    
    return res.status(200).json({
      success: true,
      action: action,
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

    // Check if market is open
    const marketState = meta.marketState;
    if (marketState === 'CLOSED' || marketState === 'PRE') {
      console.log('Market is closed, using previous close');
    }

    const price = {
      open: indicators?.open?.[0] || meta.chartPreviousClose || meta.previousClose,
      high: indicators?.high?.[0] || meta.regularMarketPrice || meta.previousClose,
      low: indicators?.low?.[0] || meta.regularMarketPrice || meta.previousClose,
      close: meta.regularMarketPrice || meta.previousClose || 0,
      volume: indicators?.volume?.[0] || 0,
      source: 'yahoo_finance'
    };

    console.log(`✅ Fetched price: ₹${price.close} (Market: ${marketState})`);
    return price;

  } catch (error) {
    console.error('Error fetching from Yahoo Finance:', error);
    
    // Fallback to NSE India API
    try {
      console.log('Trying NSE India API as fallback...');
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
