/**
 * Shared stock price fetching utilities.
 * Used by update-stock-price.js, update-saregama-price.js, and backfill scripts.
 *
 * @param {string} symbol - The Yahoo Finance / NSE symbol (e.g. 'TIPSMUSIC' or 'SAREGAMA').
 *   Yahoo Finance appends '.NS' internally; NSE India uses the bare symbol.
 * @returns {{ open, high, low, close, volume, source, tradingDate }}
 * @throws {Error} if both Yahoo Finance and NSE India fail
 */
import { fetchWithRetry } from './fetch-utils.js';

export async function fetchStockPrice(symbol) {
  console.log(`Fetching price for ${symbol}...`);
  try {
    const price = await fetchFromYahoo(symbol);
    console.log(`✅ Fetched from Yahoo Finance: ₹${price.close} (date: ${price.tradingDate})`);
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

  const response = await fetchWithRetry(url, {
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

  // Extract actual trading date from Yahoo timestamp (not server date)
  const timestamps = quote.timestamp;
  const tradingDate = timestamps?.length
    ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString().split('T')[0]
    : null;

  const close = meta.regularMarketPrice || meta.previousClose;
  if (!close || close <= 0) throw new Error('No valid close price from Yahoo Finance');

  return {
    open: indicators?.open?.[0] || null,
    high: indicators?.high?.[0] || null,
    low: indicators?.low?.[0] || null,
    close,
    volume: indicators?.volume?.[0] || 0,
    tradingDate,
    source: 'yahoo_finance'
  };
}

async function fetchFromNSE(symbol) {
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;

  const response = await fetchWithRetry(url, {
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
