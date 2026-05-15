/**
 * Trailing-window ranges used by the Stock page. Distinct from
 * date-presets.ts (which handles calendar-anchored ranges like
 * 'last_month' / 'current_fy') because equity research deep-dives think in
 * trailing windows rather than fiscal periods.
 */

export type StockRange = '1m' | '3m' | '6m' | 'YTD' | '1y' | '5y' | 'all';

export const STOCK_RANGES: StockRange[] = ['1m', '3m', '6m', 'YTD', '1y', '5y', 'all'];

export const STOCK_RANGE_LABEL: Record<StockRange, string> = {
  '1m': '1M',
  '3m': '3M',
  '6m': '6M',
  YTD: 'YTD',
  '1y': '1Y',
  '5y': '5Y',
  all: 'All',
};

export const DEFAULT_STOCK_RANGE: StockRange = '1y';

const DAYS_FOR: Partial<Record<StockRange, number>> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  '5y': 365 * 5,
};

const ALL_TIME_FROM = '2000-01-01';

/** Today, normalized to UTC midnight. Param-overridable for tests. */
function todayISO(today?: Date): string {
  const d = today ?? new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * Resolve a stock range to concrete from/to ISO dates.
 * `to` is inclusive (data on that date is included).
 */
export function resolveStockRange(
  range: StockRange,
  today?: Date,
): { from: string; to: string; label: string } {
  const to = todayISO(today);
  const label = STOCK_RANGE_LABEL[range];

  if (range === 'all') return { from: ALL_TIME_FROM, to, label };

  if (range === 'YTD') {
    const d = today ?? new Date();
    const from = `${d.getUTCFullYear()}-01-01`;
    return { from, to, label };
  }

  const days = DAYS_FOR[range];
  if (days == null) {
    return { from: ALL_TIME_FROM, to, label };
  }
  const fromDate = new Date(new Date(to + 'T00:00:00Z').getTime() - days * 86_400_000);
  return { from: fromDate.toISOString().slice(0, 10), to, label };
}

/** Parse the `?range=` URL search param with a default. */
export function parseStockRange(raw: string | undefined): StockRange {
  if (raw && (STOCK_RANGES as string[]).includes(raw)) return raw as StockRange;
  return DEFAULT_STOCK_RANGE;
}

export type StockSymbolParam = 'TIPS' | 'SARE' | 'compare';

const SYMBOL_MAP: Record<StockSymbolParam, string[]> = {
  TIPS: ['TIPSMUSIC'],
  SARE: ['SAREGAMA'],
  compare: ['TIPSMUSIC', 'SAREGAMA'],
};

export const SYMBOL_LABEL: Record<StockSymbolParam, string> = {
  TIPS: 'TIPSMUSIC',
  SARE: 'SAREGAMA',
  compare: 'Compare',
};

export function parseStockSymbol(raw: string | undefined): StockSymbolParam {
  if (raw === 'TIPS' || raw === 'SARE' || raw === 'compare') return raw;
  return 'TIPS';
}

export function symbolsFor(p: StockSymbolParam): string[] {
  return SYMBOL_MAP[p];
}
