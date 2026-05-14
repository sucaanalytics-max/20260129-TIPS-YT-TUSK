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
  return {
    symbol,
    date: new Date().toISOString().split('T')[0],
    open: info.open ?? null,
    high: info.intraDayHighLow?.max ?? null,
    low: info.intraDayHighLow?.min ?? null,
    close: info.lastPrice,
    volume: info.totalTradedVolume ?? 0,
    source: 'nse_india',
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
}
