import { createClient } from '@supabase/supabase-js';
import { fetchStockPrice } from './lib/stock-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const STOCK_SYMBOL = 'SAREGAMA';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');

  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Invalid authorization' });
  }

  console.log('🚀 Starting stock price update for SAREGAMA...');

  try {
    const stockPrice = await fetchStockPrice(STOCK_SYMBOL);

    if (!stockPrice || stockPrice.close === 0) {
      throw new Error('Failed to fetch valid stock price');
    }

    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_KEY environment variable not set');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const date = stockPrice.tradingDate || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('stock_prices')
      .upsert(
        {
          symbol: STOCK_SYMBOL,
          date,
          open: stockPrice.open,
          high: stockPrice.high,
          low: stockPrice.low,
          close: stockPrice.close,
          volume: stockPrice.volume,
          source: stockPrice.source,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'symbol,date' }
      )
      .select();

    if (error) throw error;

    console.log(`✅ Stock price upserted for ${date}: ₹${stockPrice.close}`);

    return res.status(200).json({
      success: true,
      action: 'upserted',
      stockData: {
        symbol: STOCK_SYMBOL,
        date,
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
