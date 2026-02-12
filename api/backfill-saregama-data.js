export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

    if (!SUPABASE_KEY) {
      return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
    }

    const startDate = req.query.start || '2023-01-01';
    const endDate = req.query.end || new Date().toISOString().split('T')[0];

    const symbol = 'SAREGAMA.NS';
    const dbSymbol = 'SAREGAMA';
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
        message: 'No data from Yahoo Finance'
      });
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};

    const records = [];
    for (let i = 0; i < timestamps.length; i++) {
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      if (quotes.close?.[i]) {
        records.push({
          symbol: dbSymbol,
          date: date,
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
          details.push({ date: record.date, close: record.close, status: 'ok' });
        } else {
          failCount++;
          details.push({ date: record.date, status: 'fail', error: await response.text() });
        }

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
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
