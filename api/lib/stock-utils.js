/**
 * Shared stock price fetching utilities.
 * Used by update-stock-price.js, update-saregama-price.js, and backfill scripts.
 *
 * @param {string} symbol - The Yahoo Finance / NSE symbol (e.g. 'TIPSINDLTD' or 'SAREGAMA').
 *   Yahoo Finance appends '.NS' internally; NSE India uses the bare symbol.
 * @returns {{ open, high, low, close, volume, source }}
 * @throws {Error} if both Yahoo Finance and NSE India fail
 */
export async function fetchStockPrice(symbol) {
  console.log(`Fetching price for ${symbol}...`);
  try {
    const price = await fetchFromYahoo(symbol);
    console.log(`✅ Fetched from Yahoo Finance: ₹${price.close}`);
    return price;
  } catch (err) {
    console.error(`Yahoo Finance failed for ${symbol}:`, err.message);
    console.log('Trying NSE India API as fallback...');
    try {
      const price = await fetchFromNSE(symbol);
      console.log(`✅ Fetched from NSE India: ₹${price.close}`);
      return price;
    } catch (nseErr) {
      console.error(`NSE India also failed for ${symbol}:`, nseErr.message);
      throw new Error('All stock price sources failed');
    }
  }
}

async function fetchFromYahoo(symbol) {
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

  return {
    open: indicators?.open?.[0] || meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice,
    high: indicators?.high?.[0] || meta.regularMarketPrice || meta.previousClose,
    low: indicators?.low?.[0] || meta.regularMarketPrice || meta.previousClose,
    close: meta.regularMarketPrice || meta.previousClose || 0,
    volume: indicators?.volume?.[0] || 0,
    source: 'yahoo_finance'
  };
}

async function fetchFromNSE(symbol) {
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br'
    }
  });

  if (!response.ok) {
    throw new Error(`NSE API returned ${response.status}`);
  }

  const data = await response.json();

  return {
    open: data.priceInfo?.open || 0,
    high: data.priceInfo?.intraDayHighLow?.max || 0,
    low: data.priceInfo?.intraDayHighLow?.min || 0,
    close: data.priceInfo?.lastPrice || 0,
    volume: data.priceInfo?.totalTradedVolume || 0,
    source: 'nse_india'
  };
}
