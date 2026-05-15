import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * Stock price fetcher: Yahoo Finance primary, NSE India fallback.
 * Symbols are bare NSE symbols (e.g. 'TIPSMUSIC'); Yahoo gets '.NS' appended.
 */

export interface PriceRow {
  symbol: string;
  date: string;            // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
  source: 'yahoo_finance' | 'nse_india';
}

export async function fetchStockPrice(symbol: string): Promise<PriceRow> {
  try {
    return await fetchFromYahoo(symbol);
  } catch (err) {
    console.warn(`Yahoo failed for ${symbol}: ${(err as Error).message}. Falling back to NSE.`);
    return await fetchFromNSE(symbol);
  }
}

async function fetchFromYahoo(symbol: string): Promise<PriceRow> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=5d`;
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const data = (await res.json()) as YahooChart;
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('No Yahoo result');

  const timestamps = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!timestamps.length || !q) throw new Error('Empty Yahoo quote');
  const lastIdx = timestamps.length - 1;
  const close = q.close?.[lastIdx] ?? result.meta?.regularMarketPrice;
  if (!close || close <= 0) throw new Error('No valid close from Yahoo');

  return {
    symbol,
    date: new Date(timestamps[lastIdx] * 1000).toISOString().split('T')[0],
    open: q.open?.[lastIdx] ?? null,
    high: q.high?.[lastIdx] ?? null,
    low: q.low?.[lastIdx] ?? null,
    close,
    volume: q.volume?.[lastIdx] ?? 0,
    source: 'yahoo_finance',
  };
}

async function fetchFromNSE(symbol: string): Promise<PriceRow> {
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`NSE ${res.status}`);
  const data = (await res.json()) as NSEEquity;
  const info = data.priceInfo;
  if (!info?.lastPrice) throw new Error('No NSE priceInfo');

  // NSE returns `metadata.lastUpdateTime` like "08-May-2024 15:30:00".
  // Parse it as the trading date so weekend/holiday calls don't overwrite
  // today's row with a stale lastPrice.
  const tradingDate = parseNSEDate(data.metadata?.lastUpdateTime) ??
    new Date().toISOString().slice(0, 10);

  return {
    symbol,
    date: tradingDate,
    open: info.open ?? null,
    high: info.intraDayHighLow?.max ?? null,
    low: info.intraDayHighLow?.min ?? null,
    close: info.lastPrice,
    volume: info.totalTradedVolume ?? 0,
    source: 'nse_india',
  };
}

// "08-May-2024 15:30:00" → "2024-05-08"
function parseNSEDate(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const mm = months[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}`;
}

/**
 * Fetches a Yahoo Finance index quote (e.g. ^CRSMID, ^NSEI). Unlike fetchStockPrice
 * this returns the last trading day's OHLCV; no NSE fallback (NSE doesn't expose
 * index quotes via the equity endpoint).
 */
export async function fetchIndexQuote(yahooSymbol: string): Promise<{
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Yahoo index ${yahooSymbol} ${res.status}`);
  const data = (await res.json()) as YahooChart;
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0];
  if (!timestamps.length || !q) throw new Error(`Empty Yahoo index payload for ${yahooSymbol}`);
  const lastIdx = timestamps.length - 1;
  const close = q.close?.[lastIdx] ?? result?.meta?.regularMarketPrice;
  if (!close || close <= 0) throw new Error(`No valid index close for ${yahooSymbol}`);
  return {
    date: new Date(timestamps[lastIdx] * 1000).toISOString().slice(0, 10),
    open: q.open?.[lastIdx] ?? null,
    high: q.high?.[lastIdx] ?? null,
    low: q.low?.[lastIdx] ?? null,
    close,
    volume: q.volume?.[lastIdx] ?? 0,
  };
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: { regularMarketPrice?: number };
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface NSEEquity {
  priceInfo?: {
    open?: number;
    lastPrice?: number;
    totalTradedVolume?: number;
    intraDayHighLow?: { max?: number; min?: number };
  };
  metadata?: {
    lastUpdateTime?: string;
  };
}
