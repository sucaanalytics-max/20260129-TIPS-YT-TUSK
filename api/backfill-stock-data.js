import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Require CRON_SECRET to prevent unauthorised backfill triggers
  const authHeader = req.headers.authorization;
  const providedSecret = authHeader?.replace('Bearer ', '');

  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    if (!SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const startDate = req.query.start || '2023-01-01';
    const endDate = req.query.end || new Date().toISOString().split('T')[0];

    // Yahoo uses TIPSMUSIC.NS (was TIPSINDLTD.NS, delisted) but we store as TIPSMUSIC
    const symbol = 'TIPSMUSIC.NS';
    const dbSymbol = 'TIPSMUSIC';
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
      return res.status(404).json({ success: false, message: 'No data from Yahoo Finance' });
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};

    const records = [];
    for (let i = 0; i < timestamps.length; i++) {
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      if (quotes.close?.[i]) {
        records.push({
          symbol: dbSymbol,
          date,
          open: quotes.open?.[i] || 0,
          high: quotes.high?.[i] || 0,
          low: quotes.low?.[i] || 0,
          close: quotes.close?.[i] || 0,
          volume: quotes.volume?.[i] || 0,
          source: 'yahoo_finance'
        });
      }
    }

    let successCount = 0;
    let failCount = 0;
    const details = [];

    for (const record of records) {
      try {
        const { error } = await supabase
          .from('stock_prices')
          .upsert(record, { onConflict: 'symbol,date' });

        if (error) throw error;

        successCount++;
        details.push({ date: record.date, close: record.close, status: 'ok' });
      } catch (error) {
        failCount++;
        details.push({ date: record.date, status: 'fail', error: error.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Backfill completed',
      symbol: dbSymbol,
      dateRange: { start: startDate, end: endDate },
      summary: {
        total: records.length,
        successful: successCount,
        failed: failCount
      },
      records: details
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
