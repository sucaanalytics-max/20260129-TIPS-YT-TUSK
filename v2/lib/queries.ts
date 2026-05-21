import 'server-only';
import { getServiceSupabase } from '@/lib/supabase/server';
import {
  viewMomentum,
  catalogFreshness,
  freshnessRatioAsOf,
  leadLagRead,
  relativeStrength,
  divergence,
  subscriberDrift,
  peerRankMomentum,
  liveEventDensity,
  type SignalsSnapshot,
  type VideoFreshnessInput,
} from '@/lib/signals';
import {
  annualizedVolatility,
  beta,
  cumulativeRelativePerformance,
  fiftyTwoWeekRange,
  logReturns,
  maxDrawdown,
  periodReturn,
  returnSinceDate,
} from '@/lib/risk';
import { resolveStockRange, type StockRange } from '@/lib/stock-range';

export type { SignalsSnapshot } from '@/lib/signals';
export type { StockRange } from '@/lib/stock-range';

/**
 * Server-only data layer for the Tusk v2 dashboard.
 *
 * Every function is designed to call-once-per-render and tolerate missing
 * tables/rows during early ingest (returns nulls / empty arrays). The route
 * components render placeholders in that state. Cache invalidation is via
 * cacheTag()s named in [v2/lib/revalidate.ts](v2/lib/revalidate.ts).
 */

// ---- Types ------------------------------------------------------------------

export interface OverviewKpi {
  label: string;
  value: string;
  delta?: string;
  hint?: string;
}

export interface OverviewData {
  asOf: string | null;
  kpis: OverviewKpi[];
}

export interface FreshnessRow {
  source: string;
  latest_date: string | null;
  row_count: number;
}

export interface DualAxisRow {
  date: string;
  daily_views: number | null;
  close: number | null;
  adjusted_close: number | null;
}

export interface RollingCorrelationRow {
  asof: string;
  window_days: number;
  lag_days: number;
  pearson_r: number;
  spearman_rho: number | null;
  n_obs: number;
  p_value_raw: number | null;
  p_value_fdr: number | null;
  is_significant: boolean | null;
}

export interface LeadLagRow {
  lag_days: number;
  pearson_r: number;
  p_value_fdr: number | null;
  is_significant: boolean | null;
}

export interface EventStudyRow {
  event_type: string;
  day_offset: number;
  mean_ar: number;
  mean_car: number;
  ci_lo: number;
  ci_hi: number;
  n_obs: number;
}

export interface ChannelLeaderboardRow {
  channel_id: string;
  channel_name: string;
  company: string;
  language: string | null;
  date: string;
  total_views: number | null;
  subscribers: number | null;
  daily_views: number | null;
  daily_subscribers: number | null;
  daily_videos: number | null;
}

export interface LanguageRollupRow {
  language: string | null;
  company: string;
  channel_count: number;
  total_views: number | null;
  subscribers: number | null;
  daily_views_7d_avg: number | null;
}

export interface EventTimelineRow {
  event_id: number;
  event_date: string;
  event_type: string;
  label: string;
  channel_id: string | null;
  company: string | null;
}

export interface OpsRunRow {
  run_id: number;
  source: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  rows_in: number | null;
  rows_out: number | null;
  detail: Record<string, unknown> | null;
}

export interface OpsErrorRow {
  id: number;
  error_type: string;
  error_message: string;
  ingest_run_id: number | null;
  created_at: string;
}

// ---- Freshness + Overview (existing, expanded) -----------------------------

export async function getFreshness(): Promise<FreshnessRow[]> {
  const supabase = getServiceSupabase();

  async function one(table: string): Promise<FreshnessRow> {
    try {
      const { data, count } = await supabase
        .from(table)
        .select('date', { count: 'exact', head: false })
        .order('date', { ascending: false })
        .limit(1);
      return {
        source: table,
        latest_date: (data?.[0] as { date?: string } | undefined)?.date ?? null,
        row_count: count ?? 0,
      };
    } catch {
      return { source: table, latest_date: null, row_count: 0 };
    }
  }

  return await Promise.all([
    one('fct_channel_daily'),
    one('fct_video_daily'),
    one('fct_price_daily'),
    one('dim_market_index'),
  ]);
}

export async function getOverview(): Promise<OverviewData> {
  const supabase = getServiceSupabase();

  const { data: priceRows } = await supabase
    .from('fct_price_daily')
    .select('date, close, daily_change, daily_change_pct')
    .eq('symbol', 'TIPSMUSIC')
    .order('date', { ascending: false })
    .limit(1);
  const latestPrice = priceRows?.[0];

  const { data: channelRows } = await supabase
    .from('v_company_daily')
    .select('date, daily_views, daily_subscribers, total_views, subscribers')
    .eq('company', 'TIPSMUSIC')
    .order('date', { ascending: false })
    .limit(1);
  const latestChannel = channelRows?.[0];

  const asOf =
    latestPrice?.date && latestChannel?.date
      ? latestPrice.date > latestChannel.date
        ? latestPrice.date
        : latestChannel.date
      : (latestPrice?.date ?? latestChannel?.date ?? null);

  const kpis: OverviewKpi[] = [
    {
      label: 'TIPSMUSIC close',
      value: latestPrice?.close != null ? `₹${Number(latestPrice.close).toFixed(2)}` : '—',
      delta:
        latestPrice?.daily_change_pct != null
          ? `${Number(latestPrice.daily_change_pct).toFixed(2)}%`
          : undefined,
      hint: latestPrice?.date ? `as of ${latestPrice.date}` : 'no data',
    },
    {
      label: 'Daily views (Tips, all channels)',
      value:
        latestChannel?.daily_views != null
          ? Number(latestChannel.daily_views).toLocaleString()
          : '—',
      hint: latestChannel?.date ? `as of ${latestChannel.date}` : 'no data',
    },
    {
      label: 'Subscribers (Tips total)',
      value:
        latestChannel?.subscribers != null
          ? Number(latestChannel.subscribers).toLocaleString()
          : '—',
      hint: 'YouTube rounds subs > 1k',
    },
    {
      label: 'Cumulative views (Tips)',
      value:
        latestChannel?.total_views != null
          ? Number(latestChannel.total_views).toLocaleString()
          : '—',
    },
  ];

  return { asOf, kpis };
}

// ---- Dual-axis time series --------------------------------------------------

export async function getDualAxisSeries(opts: {
  from?: string;
  to?: string;
  company?: 'TIPSMUSIC' | 'SAREGAMA';
}): Promise<DualAxisRow[]> {
  const supabase = getServiceSupabase();
  const company = opts.company ?? 'TIPSMUSIC';
  const from = opts.from ?? defaultFromDate(180);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const [viewsRes, priceRes, adjRes] = await Promise.all([
    supabase
      .from('v_company_daily')
      .select('date, daily_views')
      .eq('company', company)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('fct_price_daily')
      .select('date, close')
      .eq('symbol', company)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', company)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ]);

  const viewsByDate = new Map(
    (viewsRes.data ?? []).map((r) => [r.date as string, Number(r.daily_views ?? 0)]),
  );
  const priceByDate = new Map(
    (priceRes.data ?? []).map((r) => [r.date as string, Number(r.close ?? 0)]),
  );
  const adjByDate = new Map(
    (adjRes.data ?? []).map((r) => [r.date as string, Number(r.adjusted_close ?? 0)]),
  );

  const dates = new Set<string>([
    ...viewsByDate.keys(),
    ...priceByDate.keys(),
  ]);

  return Array.from(dates)
    .sort()
    .map((date) => ({
      date,
      daily_views: viewsByDate.has(date) ? viewsByDate.get(date)! : null,
      close: priceByDate.has(date) ? priceByDate.get(date)! : null,
      adjusted_close: adjByDate.has(date) ? adjByDate.get(date)! : null,
    }));
}

// ---- Correlation ------------------------------------------------------------

export async function getRollingCorrelation(opts: {
  window: 7 | 30 | 60 | 120;
  lag?: number;
  symbol?: 'TIPSMUSIC' | 'SAREGAMA';
}): Promise<RollingCorrelationRow[]> {
  const supabase = getServiceSupabase();
  const lag = opts.lag ?? 0;
  const symbol = opts.symbol ?? 'TIPSMUSIC';
  const { data } = await supabase
    .from('fct_correlation_window')
    .select('asof, window_days, lag_days, pearson_r, spearman_rho, n_obs, p_value_raw, p_value_fdr, is_significant')
    .eq('symbol', symbol)
    .eq('window_days', opts.window)
    .eq('lag_days', lag)
    .order('asof', { ascending: true });
  return (data as RollingCorrelationRow[] | null) ?? [];
}

export async function getLeadLagScan(opts: {
  window: 7 | 30 | 60 | 120;
  symbol?: 'TIPSMUSIC' | 'SAREGAMA';
}): Promise<LeadLagRow[]> {
  const supabase = getServiceSupabase();
  const symbol = opts.symbol ?? 'TIPSMUSIC';
  const { data: latest } = await supabase
    .from('fct_correlation_window')
    .select('asof')
    .eq('symbol', symbol)
    .order('asof', { ascending: false })
    .limit(1);
  const asof = latest?.[0]?.asof;
  if (!asof) return [];
  const { data } = await supabase
    .from('fct_correlation_window')
    .select('lag_days, pearson_r, p_value_fdr, is_significant')
    .eq('symbol', symbol)
    .eq('window_days', opts.window)
    .eq('asof', asof)
    .order('lag_days', { ascending: true });
  return (data as LeadLagRow[] | null) ?? [];
}

// ---- Event study ------------------------------------------------------------

export async function getEventStudy(opts: { eventType?: string }): Promise<EventStudyRow[]> {
  const supabase = getServiceSupabase();
  const { data: latest } = await supabase
    .from('fct_event_study')
    .select('asof')
    .order('asof', { ascending: false })
    .limit(1);
  const asof = latest?.[0]?.asof;
  if (!asof) return [];

  let q = supabase
    .from('fct_event_study')
    .select('event_type, day_offset, mean_ar, mean_car, ci_lo, ci_hi, n_obs')
    .eq('asof', asof)
    .order('day_offset', { ascending: true });
  if (opts.eventType) q = q.eq('event_type', opts.eventType);
  const { data } = await q;
  return (data as EventStudyRow[] | null) ?? [];
}

export async function getEventTimeline(opts: { since?: string; eventType?: string }): Promise<EventTimelineRow[]> {
  const supabase = getServiceSupabase();
  const since = opts.since ?? defaultFromDate(365);
  let q = supabase
    .from('dim_event')
    .select('event_id, event_date, event_type, label, channel_id, company')
    .gte('event_date', since)
    .order('event_date', { ascending: false })
    .limit(500);
  if (opts.eventType) q = q.eq('event_type', opts.eventType);
  const { data } = await q;
  return (data as EventTimelineRow[] | null) ?? [];
}

// ---- Channels / language breakdown -----------------------------------------

export async function getChannelLeaderboard(opts: { company?: string }): Promise<ChannelLeaderboardRow[]> {
  const supabase = getServiceSupabase();
  let q = supabase
    .from('v_channel_latest')
    .select('channel_id, channel_name, company, language, date, total_views, subscribers, daily_views, daily_subscribers, daily_videos');
  if (opts.company) q = q.eq('company', opts.company);
  const { data } = await q;
  return (data as ChannelLeaderboardRow[] | null) ?? [];
}

export async function getLanguageRollup(opts: { from?: string; to?: string }): Promise<LanguageRollupRow[]> {
  const supabase = getServiceSupabase();
  const from = opts.from ?? defaultFromDate(7);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const { data: latest } = await supabase
    .from('v_channel_latest')
    .select('channel_id, company, language, total_views, subscribers');
  const latestRows = (latest as Array<{
    channel_id: string;
    company: string;
    language: string | null;
    total_views: number | null;
    subscribers: number | null;
  }> | null) ?? [];

  const { data: window7 } = await supabase
    .from('fct_channel_daily')
    .select('channel_id, daily_views')
    .gte('date', from)
    .lte('date', to);
  const sumByChannel = new Map<string, { sum: number; n: number }>();
  for (const r of window7 ?? []) {
    if (r.daily_views == null) continue;
    const cur = sumByChannel.get(r.channel_id) ?? { sum: 0, n: 0 };
    cur.sum += Number(r.daily_views);
    cur.n += 1;
    sumByChannel.set(r.channel_id, cur);
  }

  const byKey = new Map<string, LanguageRollupRow>();
  for (const r of latestRows) {
    const key = `${r.company}|${r.language ?? 'unknown'}`;
    const w = sumByChannel.get(r.channel_id);
    const cur =
      byKey.get(key) ??
      ({
        language: r.language,
        company: r.company,
        channel_count: 0,
        total_views: 0,
        subscribers: 0,
        daily_views_7d_avg: 0,
      } as LanguageRollupRow);
    cur.channel_count += 1;
    cur.total_views = (cur.total_views ?? 0) + Number(r.total_views ?? 0);
    cur.subscribers = (cur.subscribers ?? 0) + Number(r.subscribers ?? 0);
    cur.daily_views_7d_avg = (cur.daily_views_7d_avg ?? 0) + (w ? w.sum / Math.max(1, w.n) : 0);
    byKey.set(key, cur);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    (b.daily_views_7d_avg ?? 0) - (a.daily_views_7d_avg ?? 0),
  );
}

// ---- Stock-tab data ---------------------------------------------------------

export async function getPriceWithEvents(opts: {
  from?: string;
  to?: string;
  symbol?: string;
}): Promise<{
  prices: Array<{ date: string; close: number; adjusted_close: number | null; volume: number | null }>;
  corp_actions: Array<{ ex_date: string; action_type: string; label: string }>;
}> {
  const supabase = getServiceSupabase();
  const symbol = opts.symbol ?? 'TIPSMUSIC';
  const from = opts.from ?? defaultFromDate(365);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const [pRes, aRes, caRes] = await Promise.all([
    supabase
      .from('fct_price_daily')
      .select('date, close, volume')
      .eq('symbol', symbol)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', symbol)
      .gte('date', from)
      .lte('date', to),
    supabase
      .from('dim_corporate_action')
      .select('ex_date, action_type, ratio_num, ratio_den, cash_per_share')
      .eq('symbol', symbol)
      .gte('ex_date', from),
  ]);

  const adjMap = new Map((aRes.data ?? []).map((r) => [r.date as string, Number(r.adjusted_close ?? 0)]));
  const prices = (pRes.data ?? []).map((r) => ({
    date: r.date as string,
    close: Number(r.close ?? 0),
    adjusted_close: adjMap.has(r.date as string) ? adjMap.get(r.date as string)! : null,
    volume: r.volume != null ? Number(r.volume) : null,
  }));

  const corp_actions = (caRes.data ?? []).map((r) => {
    const label =
      r.action_type === 'split' || r.action_type === 'bonus'
        ? `${r.action_type} ${r.ratio_num ?? '?'}:${r.ratio_den ?? '?'}`
        : r.action_type === 'dividend' && r.cash_per_share
          ? `dividend ₹${r.cash_per_share}`
          : r.action_type;
    return { ex_date: r.ex_date as string, action_type: r.action_type as string, label };
  });

  return { prices, corp_actions };
}

// ---- Data table -------------------------------------------------------------

export interface DataTableRow {
  date: string;
  channel_id: string;
  channel_name: string;
  company: string;
  language: string | null;
  total_views: number | null;
  subscribers: number | null;
  daily_views: number | null;
  daily_subscribers: number | null;
}

export async function getDataTable(opts: {
  from: string;
  to: string;
  channelIds?: string[];
  limit?: number;
}): Promise<DataTableRow[]> {
  const supabase = getServiceSupabase();
  const { data: channels } = await supabase
    .from('dim_channel')
    .select('channel_id, channel_name, company, language');
  const chMap = new Map(
    (channels ?? []).map((c) => [c.channel_id as string, c]),
  );

  let q = supabase
    .from('fct_channel_daily')
    .select('date, channel_id, total_views, subscribers, daily_views, daily_subscribers')
    .gte('date', opts.from)
    .lte('date', opts.to)
    .order('date', { ascending: false })
    .limit(opts.limit ?? 5000);
  if (opts.channelIds?.length) q = q.in('channel_id', opts.channelIds);

  const { data } = await q;
  return (data ?? []).map((r) => {
    const ch = chMap.get(r.channel_id as string);
    return {
      date: r.date as string,
      channel_id: r.channel_id as string,
      channel_name: (ch?.channel_name as string) ?? r.channel_id,
      company: (ch?.company as string) ?? '',
      language: (ch?.language as string | null) ?? null,
      total_views: r.total_views as number | null,
      subscribers: r.subscribers as number | null,
      daily_views: r.daily_views as number | null,
      daily_subscribers: r.daily_subscribers as number | null,
    };
  });
}

// ---- Ops audit --------------------------------------------------------------

export async function getOpsRunHistory(opts: { since?: string; limit?: number }): Promise<OpsRunRow[]> {
  const supabase = getServiceSupabase();
  const since = opts.since ?? defaultFromDate(7);
  const { data } = await supabase
    .from('ops_ingest_run')
    .select('run_id, source, started_at, ended_at, status, rows_in, rows_out, detail')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(opts.limit ?? 200);
  return (data as OpsRunRow[] | null) ?? [];
}

export async function getRecentErrors(opts: { since?: string; limit?: number }): Promise<OpsErrorRow[]> {
  const supabase = getServiceSupabase();
  const since = opts.since ?? defaultFromDate(7);
  const { data } = await supabase
    .from('ops_error_log')
    .select('id, error_type, error_message, ingest_run_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  return (data as OpsErrorRow[] | null) ?? [];
}

// ---- Growth matrix (W/M/Q/Y for both companies) ----------------------------

export type PeriodLabel = '1d' | '7d' | '30d' | '90d' | 'QTD' | 'YTD' | '365d';

export interface GrowthRow {
  company: string;
  period: PeriodLabel;
  current_sum: number | null;       // sum(daily_views) in current window
  current_n: number;                // days with data in current window
  prior_sum: number | null;         // sum(daily_views) in prior window of same length
  prior_n: number;
  growth_pct: number | null;        // (current_avg / prior_avg - 1) * 100; null if prior is empty/zero
}

export interface CompanySnapshot {
  company: string;
  channels_active: number;
  latest_date: string | null;
  cumulative_views: number | null;
  cumulative_subscribers: number | null;
  subscribers_year_ago: number | null;
  subscribers_yoy_delta: number | null;
  rows: GrowthRow[];
}

export async function getCompanyGrowth(): Promise<CompanySnapshot[]> {
  const supabase = getServiceSupabase();

  // Pull last ~800 days of company-day rows. v_company_daily aggregates by
  // is_active with legacy fallback for pre-2026 dates.
  const since = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('v_company_daily')
    .select('date, company, daily_views, subscribers, total_views, channels_with_data')
    .gte('date', since)
    .order('date', { ascending: false });

  const rows = (data ?? []) as Array<{
    date: string;
    company: string;
    daily_views: number | null;
    subscribers: number | null;
    total_views: number | null;
    channels_with_data: number | null;
  }>;

  const today = new Date();
  const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
  const startOfQuarter = (() => {
    const q = Math.floor(today.getMonth() / 3);
    return new Date(Date.UTC(today.getUTCFullYear(), q * 3, 1));
  })();
  const startOfYear = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));

  const periods: Array<{ label: PeriodLabel; from: Date; to: Date; priorFrom: Date; priorTo: Date }> = (() => {
    const todayD = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const minus = (d: Date, days: number) => new Date(d.getTime() - days * 86_400_000);
    const span = (days: number): { from: Date; to: Date; priorFrom: Date; priorTo: Date } => ({
      from: minus(todayD, days),
      to: todayD,
      priorFrom: minus(todayD, 2 * days),
      priorTo: minus(todayD, days),
    });
    const qtdLen = Math.floor((todayD.getTime() - startOfQuarter.getTime()) / 86_400_000) + 1;
    const ytdLen = Math.floor((todayD.getTime() - startOfYear.getTime()) / 86_400_000) + 1;
    return [
      { label: '1d',   ...span(1)   },
      { label: '7d',   ...span(7)   },
      { label: '30d',  ...span(30)  },
      { label: '90d',  ...span(90)  },
      { label: 'QTD',  from: startOfQuarter, to: todayD, priorFrom: minus(startOfQuarter, qtdLen), priorTo: startOfQuarter },
      { label: 'YTD',  from: startOfYear,    to: todayD, priorFrom: minus(startOfYear, ytdLen),    priorTo: startOfYear },
      { label: '365d', ...span(365) },
    ];
  })();

  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byCompany.has(r.company)) byCompany.set(r.company, []);
    byCompany.get(r.company)!.push(r);
  }

  const snapshots: CompanySnapshot[] = [];
  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    const companyRows = byCompany.get(company) ?? [];
    const latest = companyRows[0];
    const yearAgoRow = companyRows.find(
      (r) => Math.abs(daysBetween(r.date, yyyymmdd(today)) - 365) <= 3,
    );

    const growthRows: GrowthRow[] = periods.map(({ label, from, to, priorFrom, priorTo }) => {
      let curSum = 0, curN = 0, priSum = 0, priN = 0;
      for (const r of companyRows) {
        if (r.daily_views == null) continue;
        const t = new Date(r.date + 'T00:00:00Z').getTime();
        if (t >= from.getTime() && t < to.getTime() + 86_400_000) { curSum += Number(r.daily_views); curN++; }
        else if (t >= priorFrom.getTime() && t < priorTo.getTime()) { priSum += Number(r.daily_views); priN++; }
      }
      const curAvg = curN > 0 ? curSum / curN : null;
      const priAvg = priN > 0 ? priSum / priN : null;
      const growth_pct =
        curAvg != null && priAvg != null && priAvg !== 0 ? (curAvg / priAvg - 1) * 100 : null;
      return { company, period: label, current_sum: curN ? curSum : null, current_n: curN, prior_sum: priN ? priSum : null, prior_n: priN, growth_pct };
    });

    snapshots.push({
      company,
      channels_active: latest?.channels_with_data ?? 0,
      latest_date: latest?.date ?? null,
      cumulative_views: latest?.total_views != null ? Number(latest.total_views) : null,
      cumulative_subscribers: latest?.subscribers != null ? Number(latest.subscribers) : null,
      subscribers_year_ago: yearAgoRow?.subscribers != null ? Number(yearAgoRow.subscribers) : null,
      subscribers_yoy_delta:
        latest?.subscribers != null && yearAgoRow?.subscribers != null
          ? Number(latest.subscribers) - Number(yearAgoRow.subscribers)
          : null,
      rows: growthRows,
    });
  }
  return snapshots;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000);
}

// Per-channel growth table — for /channels and /growth pages.
export interface ChannelGrowthRow {
  channel_id: string;
  channel_name: string;
  company: string;
  language: string | null;
  daily_views_yesterday: number | null;
  avg_7d: number | null;
  avg_30d: number | null;
  avg_90d: number | null;
  growth_7d_pct: number | null;       // 7d avg vs prior 7d avg
  growth_30d_pct: number | null;
  growth_90d_pct: number | null;
  subscribers: number | null;
  total_views: number | null;
  daily_series_60d: Array<number | null>; // chronological last 60 days for sparkline
}

export interface CompanyViewsRow {
  date: string;
  tipsmusic: number | null;
  saregama: number | null;
}

export async function getCompanyViewsSeries(opts: { from?: string; to?: string }): Promise<CompanyViewsRow[]> {
  const supabase = getServiceSupabase();
  const from = opts.from ?? new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('v_company_daily')
    .select('date, company, daily_views')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  const rows = (data ?? []) as Array<{ date: string; company: string; daily_views: number | null }>;
  const byDate = new Map<string, CompanyViewsRow>();
  for (const r of rows) {
    const slot = byDate.get(r.date) ?? { date: r.date, tipsmusic: null, saregama: null };
    if (r.company === 'TIPSMUSIC') slot.tipsmusic = r.daily_views != null ? Number(r.daily_views) : null;
    if (r.company === 'SAREGAMA') slot.saregama = r.daily_views != null ? Number(r.daily_views) : null;
    byDate.set(r.date, slot);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getChannelGrowth(opts: { company?: string }): Promise<ChannelGrowthRow[]> {
  const supabase = getServiceSupabase();

  const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  const { data: channels } = await supabase
    .from('dim_channel')
    .select('channel_id, channel_name, company, language, is_active');
  const active = ((channels as Array<{
    channel_id: string;
    channel_name: string;
    company: string;
    language: string | null;
    is_active: boolean;
  }> | null) ?? []).filter((c) => c.is_active && (!opts.company || c.company === opts.company));

  const { data: facts } = await supabase
    .from('fct_channel_daily')
    .select('channel_id, date, daily_views, subscribers, total_views')
    .gte('date', since)
    .order('date', { ascending: false });

  const byChannel = new Map<string, Array<{ date: string; daily_views: number | null; subscribers: number | null; total_views: number | null }>>();
  for (const r of (facts ?? []) as Array<{
    channel_id: string;
    date: string;
    daily_views: number | null;
    subscribers: number | null;
    total_views: number | null;
  }>) {
    if (!byChannel.has(r.channel_id)) byChannel.set(r.channel_id, []);
    byChannel.get(r.channel_id)!.push(r);
  }

  const todayMs = Date.now();
  const days = (n: number) => todayMs - n * 86_400_000;
  const sumAvg = (
    rows: Array<{ date: string; daily_views: number | null }>,
    fromMs: number,
    toMs: number,
  ): { sum: number; n: number } => {
    let sum = 0, n = 0;
    for (const r of rows) {
      if (r.daily_views == null) continue;
      const t = new Date(r.date + 'T00:00:00Z').getTime();
      if (t >= fromMs && t < toMs) { sum += Number(r.daily_views); n += 1; }
    }
    return { sum, n };
  };

  return active.map((c) => {
    const rows = byChannel.get(c.channel_id) ?? [];
    const yesterday = rows.find((r) => r.daily_views != null);
    const latest = rows[0];

    const w = (n: number) => {
      const cur = sumAvg(rows, days(n), todayMs);
      const pri = sumAvg(rows, days(2 * n), days(n));
      const ca = cur.n ? cur.sum / cur.n : null;
      const pa = pri.n ? pri.sum / pri.n : null;
      return {
        avg: ca,
        pct: ca != null && pa != null && pa !== 0 ? (ca / pa - 1) * 100 : null,
      };
    };
    const w7 = w(7);
    const w30 = w(30);
    const w90 = w(90);

    // Build last 60 days of daily_views, chronological (oldest→newest).
    // Fill missing days with null so the sparkline's x-axis is uniform.
    const cutoffMs = todayMs - 60 * 86_400_000;
    const recent = rows
      .filter((r) => new Date(r.date + 'T00:00:00Z').getTime() >= cutoffMs)
      .sort((a, b) => a.date.localeCompare(b.date));
    const series: Array<number | null> = [];
    const todayDate = new Date();
    for (let i = 59; i >= 0; i--) {
      const d = new Date(todayDate.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      const hit = recent.find((r) => r.date === d);
      series.push(hit?.daily_views ?? null);
    }

    return {
      channel_id: c.channel_id,
      channel_name: c.channel_name,
      company: c.company,
      language: c.language,
      daily_views_yesterday: yesterday?.daily_views ?? null,
      avg_7d: w7.avg,
      avg_30d: w30.avg,
      avg_90d: w90.avg,
      growth_7d_pct: w7.pct,
      growth_30d_pct: w30.pct,
      growth_90d_pct: w90.pct,
      subscribers: latest?.subscribers != null ? Number(latest.subscribers) : null,
      total_views: latest?.total_views != null ? Number(latest.total_views) : null,
      daily_series_60d: series,
    };
  });
}

// ---- Signals (IR cockpit) ---------------------------------------------------

/**
 * Fan-out fetch + signal composition for one company. All math lives in
 * lib/signals.ts (pure). This function is the I/O boundary: it pulls the
 * minimal shape needed and feeds the pure layer.
 *
 * Lead-lag math is computed per-symbol by the Python stats service
 * (api/stats/recompute.py loops over SYMBOLS and writes fct_correlation_window
 * rows tagged by `symbol`). Both TIPSMUSIC and SAREGAMA participate as of
 * migration 0013.
 */
export async function getSignalsSnapshot(opts: {
  company: 'TIPSMUSIC' | 'SAREGAMA';
}): Promise<SignalsSnapshot> {
  const supabase = getServiceSupabase();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const since180 = iso(new Date(today.getTime() - 180 * 86_400_000));
  const since90 = iso(new Date(today.getTime() - 90 * 86_400_000));
  const last30 = iso(new Date(today.getTime() - 30 * 86_400_000));
  // Catalog-freshness baseline needs 60 historical 30d-rolling windows;
  // the earliest window starts at today-90, so we need fct_video_daily
  // from today-90 forward.
  const since90forFacts = since90;

  type EmptyResult<T> = { data: T };
  const emptyResult = <T>(data: T): Promise<EmptyResult<T>> => Promise.resolve({ data });

  // Phase 1: independent fetches.
  const [companyDailyRes, channelsRes, priceRes, indexRes, corrAsofRes] = await Promise.all([
    supabase
      .from('v_company_daily')
      .select('date, daily_views, subscribers')
      .eq('company', opts.company)
      .gte('date', since180)
      .order('date', { ascending: true }),
    supabase
      .from('dim_channel')
      .select('channel_id')
      .eq('company', opts.company)
      .eq('is_active', true),
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', opts.company)
      .gte('date', since90)
      .order('date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', 'NIFTY_MIDCAP_150')
      .gte('date', since90)
      .order('date', { ascending: true }),
    supabase
      .from('fct_correlation_window')
      .select('asof')
      .eq('symbol', opts.company)
      .order('asof', { ascending: false })
      .limit(1),
  ]);

  const companyDaily = (companyDailyRes.data ?? []) as Array<{
    date: string;
    daily_views: number | null;
    subscribers: number | null;
  }>;
  const channelIds = ((channelsRes.data ?? []) as Array<{ channel_id: string }>).map(
    (c) => c.channel_id,
  );
  const stock = (priceRes.data ?? []) as Array<{ date: string; adjusted_close: number | null }>;
  const index = (indexRes.data ?? []) as Array<{ date: string; close: number | null }>;
  const corrAsof =
    ((corrAsofRes.data ?? []) as Array<{ asof: string }>)[0]?.asof ?? null;

  // Phase 2: dependent fetches (videos + lead-lag rows for that asof).
  const [videosRes, videoFactsRes, leadLagRowsRes] = await Promise.all([
    channelIds.length > 0
      ? supabase
          .from('dim_video')
          .select('video_id, published_at, channel_id')
          .in('channel_id', channelIds)
      : emptyResult<Array<{ video_id: string; published_at: string; channel_id: string }>>([]),
    channelIds.length > 0
      ? supabase
          .from('fct_video_daily')
          .select('video_id, daily_views, date')
          .gte('date', since90forFacts)
      : emptyResult<Array<{ video_id: string; daily_views: number | null; date: string }>>([]),
    corrAsof
      ? supabase
          .from('fct_correlation_window')
          .select('lag_days, pearson_r, p_value_fdr, is_significant')
          .eq('symbol', opts.company)
          .eq('window_days', 30)
          .eq('asof', corrAsof)
          .order('lag_days', { ascending: true })
      : emptyResult<
          Array<{
            lag_days: number;
            pearson_r: number;
            p_value_fdr: number | null;
            is_significant: boolean | null;
          }>
        >([]),
  ]);

  const videos = (videosRes.data ?? []) as Array<{
    video_id: string;
    published_at: string;
    channel_id: string;
  }>;
  const videoFacts = (videoFactsRes.data ?? []) as Array<{
    video_id: string;
    daily_views: number | null;
    date: string;
  }>;
  const leadLagRows = (leadLagRowsRes.data ?? []) as Array<{
    lag_days: number;
    pearson_r: number;
    p_value_fdr: number | null;
    is_significant: boolean | null;
  }>;

  // videoFacts is fetched over the wider 90d window for the baseline below.
  // For the current-window signal input, sum only the trailing 30d.
  const last30Ms = new Date(last30 + 'T00:00:00Z').getTime();
  const viewsByVideo = new Map<string, number>();
  for (const r of videoFacts) {
    if (r.daily_views == null) continue;
    const dMs = new Date(r.date + 'T00:00:00Z').getTime();
    if (dMs < last30Ms) continue;
    viewsByVideo.set(r.video_id, (viewsByVideo.get(r.video_id) ?? 0) + Number(r.daily_views));
  }
  const channelSet = new Set(channelIds);
  const ourVideos = videos.filter((v) => channelSet.has(v.channel_id));
  const videoInputs: VideoFreshnessInput[] = ourVideos
    .map((v) => ({
      published_at: v.published_at,
      views_last_30d: viewsByVideo.get(v.video_id) ?? 0,
    }))
    .filter((v) => v.views_last_30d > 0);

  // Build catalog-freshness baseline: 60 historical 30d-rolling ratios.
  // catalogFreshness() uses this distribution to z-score the current ratio,
  // sidestepping the structural bias of static thresholds (Saregama legacy
  // would always sit < 0.3, TIPS frontline always > 0.6).
  const ourVideoIds = new Set(ourVideos.map((v) => v.video_id));
  const ourFacts = videoFacts.filter((f) => ourVideoIds.has(f.video_id));
  const baselineRatios: number[] = [];
  for (let i = 1; i <= 60; i++) {
    const asOf = new Date(today.getTime() - i * 86_400_000);
    const r = freshnessRatioAsOf(ourVideos, ourFacts, asOf);
    if (r != null) baselineRatios.push(r);
  }

  // Compute price momentum (z-score of 7d-avg adjusted_close) for divergence.
  // We re-use viewMomentum on a price-shaped series for consistency.
  const priceShaped = stock.map((r) => ({ date: r.date, daily_views: r.adjusted_close }));
  const priceMom = viewMomentum(priceShaped);

  const viewMom = viewMomentum(
    companyDaily.map((r) => ({ date: r.date, daily_views: r.daily_views })),
  );
  const fresh = catalogFreshness(videoInputs, today, baselineRatios);
  const ll = leadLagRead(leadLagRows);
  const rs = relativeStrength(stock, index, 30);
  const div = divergence(viewMom.sigma ?? null, priceMom.sigma ?? null);
  const subs = subscriberDrift(
    companyDaily.map((r) => ({ date: r.date, subscribers: r.subscribers })),
  );

  // PR 3a additions: peer rank + live event density. Fail-soft if SB data
  // hasn't landed yet (returns warming cells per the pure-fn contract).
  const [rankTraj, liveEvts] = await Promise.all([
    getRankTrajectory({ company: opts.company, days: 180 }),
    getLiveEventInputs({ company: opts.company, days: 90 }),
  ]);
  const peerRank = peerRankMomentum(rankTraj);
  const liveDen = liveEventDensity(liveEvts);

  const asOf = companyDaily.length > 0 ? companyDaily[companyDaily.length - 1].date : null;
  const daysAvailable = companyDaily.filter((r) => r.daily_views != null).length;

  return {
    company: opts.company,
    asOf,
    daysAvailable,
    viewMomentum: viewMom,
    catalogFreshness: fresh,
    leadLag: ll,
    relativeStrength: rs,
    divergence: div,
    subscriberDrift: subs,
    peerRankMomentum: peerRank,
    liveEventDensity: liveDen,
  };
}

/**
 * Upcoming events for the next N days. Variant of getEventTimeline with a
 * forward-looking window — drives the Event Horizon strip on /signals.
 */
export async function getEventHorizon(opts: { days?: number } = {}): Promise<EventTimelineRow[]> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 30;
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('dim_event')
    .select('event_id, event_date, event_type, label, channel_id, company')
    .gte('event_date', today)
    .lte('event_date', until)
    .order('event_date', { ascending: true })
    .limit(100);
  return (data as EventTimelineRow[] | null) ?? [];
}

/**
 * Lead-lag rows for the latest asof (any window). Used by the
 * LeadLagPanorama on /signals to render bars without a separate fetch.
 */
export async function getLeadLagPanorama(opts: { window: 7 | 30 | 60 | 120 } = { window: 30 }): Promise<LeadLagRow[]> {
  return getLeadLagScan({ window: opts.window });
}

// ---- helpers ----------------------------------------------------------------

function defaultFromDate(daysBack: number): string {
  return new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export const formatNumber = (n: number | null | undefined): string =>
  n == null ? '—' : Number(n).toLocaleString();

export const formatPct = (n: number | null | undefined, digits = 2): string =>
  n == null ? '—' : `${Number(n).toFixed(digits)}%`;

export const formatPrice = (n: number | null | undefined): string =>
  n == null ? '—' : `₹${Number(n).toFixed(2)}`;

// =============================================================================
// Overview (daily monitor) + Stock (research deep-dive) queries
// =============================================================================

type Company = 'TIPSMUSIC' | 'SAREGAMA';

// ---- Overview ---------------------------------------------------------------

export interface DualSymbolHeadlineRow {
  company: Company;
  latest_date: string | null;
  range: StockRange;
  range_label: string;
  // Close: latest + return over selected range (log return on adjusted close)
  close: number | null;
  close_return: number | null;
  // Views: latest daily + range avg vs prior-equal-range avg
  daily_views_latest: number | null;
  views_avg_current: number | null;
  views_avg_prior: number | null;
  views_delta_pct: number | null;
  views_window_days: number;            // for the "Nd avg vs prior Nd" tile hint
  // Subscribers: latest + Δ over range (subs[latest] - subs[range start])
  subscribers: number | null;
  subs_delta: number | null;
  // Daily-views sparkline: length matches range, capped at 365 points
  sparkline: Array<number | null>;
}

/**
 * Single fan-out for the Overview KPI strip — returns one row per company
 * (TIPSMUSIC, SAREGAMA) with latest close, daily views, subscribers and a
 * sparkline, anchored to the selected range. Deltas are computed against the
 * range start (or, for `all`, against inception / YoY where prior-equal-range
 * is undefined).
 */
export async function getDualSymbolHeadline(
  opts: { range?: StockRange } = {},
): Promise<DualSymbolHeadlineRow[]> {
  const supabase = getServiceSupabase();
  const range: StockRange = opts.range ?? '1y';
  const resolved = resolveStockRange(range);
  const todayIso = new Date().toISOString().slice(0, 10);
  // Range length in days (used for prior-equal-range comparison + sparkline length)
  const rangeDays = Math.max(
    1,
    Math.round(
      (new Date(resolved.to + 'T00:00:00Z').getTime() -
        new Date(resolved.from + 'T00:00:00Z').getTime()) /
        86_400_000,
    ),
  );
  // For range='all', sparkline capped at 365 days; otherwise match the range.
  const sparkDays = range === 'all' ? 365 : Math.min(rangeDays, 365);
  // Pull enough history for the range plus prior-equal-range comparison (2x).
  const historyDays = range === 'all' ? 365 * 6 : rangeDays * 2 + 10;
  const since = new Date(Date.now() - historyDays * 86_400_000).toISOString().slice(0, 10);

  const [priceRes, adjPriceRes, viewsRes] = await Promise.all([
    supabase
      .from('fct_price_daily')
      .select('symbol, date, close')
      .in('symbol', ['TIPSMUSIC', 'SAREGAMA'])
      .gte('date', since)
      .lte('date', todayIso)
      .order('date', { ascending: true }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('symbol, date, adjusted_close')
      .in('symbol', ['TIPSMUSIC', 'SAREGAMA'])
      .gte('date', since)
      .lte('date', todayIso)
      .order('date', { ascending: true }),
    supabase
      .from('v_company_daily')
      .select('company, date, daily_views, subscribers')
      .in('company', ['TIPSMUSIC', 'SAREGAMA'])
      .gte('date', since)
      .lte('date', todayIso)
      .order('date', { ascending: true }),
  ]);

  const prices = (priceRes.data ?? []) as Array<{
    symbol: string;
    date: string;
    close: number | null;
  }>;
  const adjPrices = (adjPriceRes.data ?? []) as Array<{
    symbol: string;
    date: string;
    adjusted_close: number | null;
  }>;
  const views = (viewsRes.data ?? []) as Array<{
    company: string;
    date: string;
    daily_views: number | null;
    subscribers: number | null;
  }>;

  const out: DualSymbolHeadlineRow[] = [];

  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    const pricesC = prices.filter((p) => p.symbol === company);
    const adjPricesC = adjPrices.filter((p) => p.symbol === company);
    const viewsC = views.filter((v) => v.company === company);

    const latestPrice = pricesC[pricesC.length - 1];
    const close = latestPrice?.close != null ? Number(latestPrice.close) : null;

    // Close return = log(adj_close[latest] / adj_close[at-or-after range.from])
    let close_return: number | null = null;
    if (adjPricesC.length > 0) {
      const last = adjPricesC[adjPricesC.length - 1];
      const anchor = adjPricesC.find(
        (p) => p.date >= resolved.from && p.adjusted_close != null && Number(p.adjusted_close) > 0,
      );
      if (
        last?.adjusted_close != null &&
        anchor?.adjusted_close != null &&
        Number(anchor.adjusted_close) > 0
      ) {
        close_return = Math.log(Number(last.adjusted_close) / Number(anchor.adjusted_close));
      }
    }

    const latestViews = viewsC[viewsC.length - 1];
    const daily_views_latest =
      latestViews?.daily_views != null ? Number(latestViews.daily_views) : null;

    // Views avg over the current range and prior-equal-range
    function avgInRange(fromDate: string, toDate: string): number | null {
      const nums = viewsC
        .filter((r) => r.date >= fromDate && r.date <= toDate)
        .map((r) => (r.daily_views == null ? null : Number(r.daily_views)))
        .filter((n): n is number => n != null);
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    }

    const views_avg_current = avgInRange(resolved.from, resolved.to);

    // Prior-equal-range: shift the window back by `rangeDays`. For 'all',
    // there is no prior range — fall back to YoY (last 365d vs prior 365d).
    let views_avg_prior: number | null = null;
    let views_window_days = rangeDays;
    if (range === 'all') {
      const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
      views_avg_prior = avgInRange(twoYearsAgo, oneYearAgo);
      views_window_days = 365;
    } else {
      const priorTo = new Date(new Date(resolved.from + 'T00:00:00Z').getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const priorFrom = new Date(
        new Date(resolved.from + 'T00:00:00Z').getTime() - rangeDays * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      views_avg_prior = avgInRange(priorFrom, priorTo);
    }
    const views_delta_pct =
      views_avg_current != null && views_avg_prior != null && views_avg_prior !== 0
        ? ((views_avg_current - views_avg_prior) / views_avg_prior) * 100
        : null;

    // Sparkline: last `sparkDays` chronological values (oldest→newest).
    const todayMs = Date.now();
    const sparkline: Array<number | null> = [];
    for (let i = sparkDays - 1; i >= 0; i--) {
      const d = new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10);
      const hit = viewsC.find((v) => v.date === d);
      sparkline.push(hit?.daily_views != null ? Number(hit.daily_views) : null);
    }

    // Subscribers + range Δ (subs[latest] - subs[at-or-after range start])
    const subscribers =
      latestViews?.subscribers != null ? Number(latestViews.subscribers) : null;
    let subs_delta: number | null = null;
    if (subscribers != null) {
      const anchorRow =
        range === 'all'
          ? viewsC.find((v) => v.subscribers != null)
          : viewsC.find((v) => v.date >= resolved.from && v.subscribers != null);
      if (anchorRow?.subscribers != null) {
        subs_delta = subscribers - Number(anchorRow.subscribers);
      }
    }

    out.push({
      company,
      latest_date: latestPrice?.date ?? latestViews?.date ?? null,
      range,
      range_label: resolved.label,
      close,
      close_return,
      daily_views_latest,
      views_avg_current,
      views_avg_prior,
      views_delta_pct,
      views_window_days,
      subscribers,
      subs_delta,
      sparkline,
    });
  }

  return out;
}

export interface DualSymbolChartRow {
  date: string;
  tips_views: number | null;
  sare_views: number | null;
  tips_close: number | null;
  sare_close: number | null;
}

/**
 * Joined daily series of TIPS + SARE views + adjusted closes for the
 * Overview headline chart.
 */
export async function getDualSymbolChartSeries(opts: { from?: string; to?: string } = {}): Promise<DualSymbolChartRow[]> {
  const supabase = getServiceSupabase();
  const from = opts.from ?? new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const [viewsRes, priceRes] = await Promise.all([
    supabase
      .from('v_company_daily')
      .select('date, company, daily_views')
      .in('company', ['TIPSMUSIC', 'SAREGAMA'])
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, symbol, adjusted_close')
      .in('symbol', ['TIPSMUSIC', 'SAREGAMA'])
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ]);

  const views = (viewsRes.data ?? []) as Array<{
    date: string;
    company: string;
    daily_views: number | null;
  }>;
  const prices = (priceRes.data ?? []) as Array<{
    date: string;
    symbol: string;
    adjusted_close: number | null;
  }>;

  const byDate = new Map<string, DualSymbolChartRow>();
  function slot(date: string): DualSymbolChartRow {
    const cur = byDate.get(date) ?? {
      date,
      tips_views: null,
      sare_views: null,
      tips_close: null,
      sare_close: null,
    };
    byDate.set(date, cur);
    return cur;
  }
  for (const v of views) {
    const s = slot(v.date);
    if (v.company === 'TIPSMUSIC') s.tips_views = v.daily_views != null ? Number(v.daily_views) : null;
    else if (v.company === 'SAREGAMA') s.sare_views = v.daily_views != null ? Number(v.daily_views) : null;
  }
  for (const p of prices) {
    const s = slot(p.date);
    if (p.symbol === 'TIPSMUSIC') s.tips_close = p.adjusted_close != null ? Number(p.adjusted_close) : null;
    else if (p.symbol === 'SAREGAMA') s.sare_close = p.adjusted_close != null ? Number(p.adjusted_close) : null;
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Stock ------------------------------------------------------------------

export interface StockPriceRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjusted_close: number | null;
  volume: number | null;
}

export interface StockDeepDive {
  symbol: string;
  range: StockRange;
  from: string;
  to: string;
  prices: StockPriceRow[];
  views: Array<{ date: string; daily_views: number | null }>;
  corp_actions: Array<{ ex_date: string; action_type: string; label: string }>;
  index_midcap150: Array<{ date: string; close: number | null }>;
  index_nifty50: Array<{ date: string; close: number | null }>;
  fiftyTwoWeek: { high: number; low: number; current: number; position_pct: number } | null;
}

/**
 * Fan-out for the Stock page (single symbol). Pulls everything the page
 * needs for the price chart + relative performance + hero stats.
 */
export async function getStockDeepDive(opts: {
  symbol: string;
  range: StockRange;
}): Promise<StockDeepDive> {
  const supabase = getServiceSupabase();
  const { from, to } = resolveStockRange(opts.range);
  // For 52-week range we need at least 365 days regardless of selected range.
  const since52w = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);

  const [pRes, aRes, caRes, mRes, n50Res, p52Res, vRes] = await Promise.all([
    supabase
      .from('fct_price_daily')
      .select('date, open, high, low, close, volume')
      .eq('symbol', opts.symbol)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', opts.symbol)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('dim_corporate_action')
      .select('ex_date, action_type, ratio_num, ratio_den, cash_per_share')
      .eq('symbol', opts.symbol)
      .gte('ex_date', from)
      .lte('ex_date', to)
      .order('ex_date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', 'NIFTY_MIDCAP_150')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', 'NIFTY_50')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    // 52-week window — independent of selected range.
    supabase
      .from('fct_price_daily')
      .select('date, close')
      .eq('symbol', opts.symbol)
      .gte('date', since52w)
      .order('date', { ascending: true }),
    // YouTube daily views aggregated to the company (symbol ↔ company 1:1).
    supabase
      .from('v_company_daily')
      .select('date, daily_views')
      .eq('company', opts.symbol)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ]);

  const adjMap = new Map(
    ((aRes.data ?? []) as Array<{ date: string; adjusted_close: number | null }>).map((r) => [
      r.date,
      r.adjusted_close != null ? Number(r.adjusted_close) : null,
    ]),
  );
  const prices: StockPriceRow[] = ((pRes.data ?? []) as Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }>).map((r) => ({
    date: r.date,
    open: r.open != null ? Number(r.open) : null,
    high: r.high != null ? Number(r.high) : null,
    low: r.low != null ? Number(r.low) : null,
    close: Number(r.close),
    adjusted_close: adjMap.get(r.date) ?? null,
    volume: r.volume != null ? Number(r.volume) : null,
  }));

  const corp_actions = ((caRes.data ?? []) as Array<{
    ex_date: string;
    action_type: string;
    ratio_num: number | null;
    ratio_den: number | null;
    cash_per_share: number | null;
  }>).map((r) => {
    const label =
      r.action_type === 'split' || r.action_type === 'bonus'
        ? `${r.action_type} ${r.ratio_num ?? '?'}:${r.ratio_den ?? '?'}`
        : r.action_type === 'dividend' && r.cash_per_share != null
          ? `dividend ₹${r.cash_per_share}`
          : r.action_type;
    return { ex_date: r.ex_date, action_type: r.action_type, label };
  });

  const index_midcap150 = ((mRes.data ?? []) as Array<{ date: string; close: number | null }>).map(
    (r) => ({ date: r.date, close: r.close != null ? Number(r.close) : null }),
  );
  const index_nifty50 = ((n50Res.data ?? []) as Array<{ date: string; close: number | null }>).map(
    (r) => ({ date: r.date, close: r.close != null ? Number(r.close) : null }),
  );

  const p52 = (p52Res.data ?? []) as Array<{ date: string; close: number | null }>;
  const fiftyTwoWeek = fiftyTwoWeekRange(
    p52.map((r) => ({ date: r.date, close: r.close != null ? Number(r.close) : null })),
  );

  const views = ((vRes.data ?? []) as Array<{
    date: string;
    daily_views: number | null;
  }>).map((r) => ({
    date: r.date,
    daily_views: r.daily_views != null ? Number(r.daily_views) : null,
  }));

  return {
    symbol: opts.symbol,
    range: opts.range,
    from,
    to,
    prices,
    views,
    corp_actions,
    index_midcap150,
    index_nifty50,
    fiftyTwoWeek,
  };
}

export interface ReturnsMatrixRow {
  symbol: string;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_ytd: number | null;
  ret_1y: number | null;
  ret_3y: number | null;
  ret_inception: number | null;
}

/**
 * 8 standard returns for a symbol, computed from fct_adjusted_price_daily.
 */
export async function getReturnsMatrix(opts: { symbol: string }): Promise<ReturnsMatrixRow> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('fct_adjusted_price_daily')
    .select('date, adjusted_close')
    .eq('symbol', opts.symbol)
    .order('date', { ascending: true });
  const prices = ((data ?? []) as Array<{ date: string; adjusted_close: number | null }>).map(
    (r) => ({
      date: r.date,
      close: r.adjusted_close != null ? Number(r.adjusted_close) : null,
    }),
  );

  const ytdAnchor = new Date(new Date().getUTCFullYear(), 0, 1).toISOString().slice(0, 10);

  return {
    symbol: opts.symbol,
    ret_1d: periodReturn(prices, 1),
    ret_5d: periodReturn(prices, 5),
    ret_1m: periodReturn(prices, 30),
    ret_3m: periodReturn(prices, 90),
    ret_6m: periodReturn(prices, 180),
    ret_ytd: returnSinceDate(prices, ytdAnchor),
    ret_1y: periodReturn(prices, 365),
    ret_3y: periodReturn(prices, 365 * 3),
    ret_inception:
      prices.length > 0 && prices[0].close != null && prices[prices.length - 1].close != null
        ? Math.log((prices[prices.length - 1].close as number) / (prices[0].close as number))
        : null,
  };
}

export interface RiskMetrics {
  symbol: string;
  window_days: number;
  annualized_vol: number | null;
  max_drawdown_pct: number | null;
  max_drawdown_peak: string | null;
  max_drawdown_trough: string | null;
  beta_midcap150: number | null;
  beta_nifty50: number | null;
}

/**
 * Annualized vol, max drawdown, and betas for a symbol over the last
 * `windowDays` (default 252 = 1 year of trading days).
 */
export async function getRiskMetrics(opts: {
  symbol: string;
  windowDays?: number;
}): Promise<RiskMetrics> {
  const supabase = getServiceSupabase();
  const windowDays = opts.windowDays ?? 252;
  const since = new Date(Date.now() - (windowDays + 30) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [pRes, mRes, n50Res] = await Promise.all([
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', opts.symbol)
      .gte('date', since)
      .order('date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', 'NIFTY_MIDCAP_150')
      .gte('date', since)
      .order('date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', 'NIFTY_50')
      .gte('date', since)
      .order('date', { ascending: true }),
  ]);

  const prices = ((pRes.data ?? []) as Array<{ date: string; adjusted_close: number | null }>).map(
    (r) => ({ date: r.date, close: r.adjusted_close != null ? Number(r.adjusted_close) : null }),
  );
  const midcap = ((mRes.data ?? []) as Array<{ date: string; close: number | null }>).map((r) => ({
    date: r.date,
    close: r.close != null ? Number(r.close) : null,
  }));
  const nifty50 = ((n50Res.data ?? []) as Array<{ date: string; close: number | null }>).map(
    (r) => ({ date: r.date, close: r.close != null ? Number(r.close) : null }),
  );

  const priceVals = prices.map((p) => p.close);
  const stockReturns = logReturns(priceVals);
  const dd = maxDrawdown(priceVals);

  function alignedReturns(idx: Array<{ date: string; close: number | null }>) {
    const idxMap = new Map(idx.map((r) => [r.date, r.close]));
    const stockPaired: number[] = [];
    const indexPaired: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const sa = prices[i - 1].close;
      const sb = prices[i].close;
      const ia = idxMap.get(prices[i - 1].date);
      const ib = idxMap.get(prices[i].date);
      if (sa == null || sb == null || sa <= 0 || sb <= 0) continue;
      if (ia == null || ib == null || ia <= 0 || ib <= 0) continue;
      stockPaired.push(Math.log(sb) - Math.log(sa));
      indexPaired.push(Math.log(ib) - Math.log(ia));
    }
    return { stock: stockPaired, idx: indexPaired };
  }

  const m = alignedReturns(midcap);
  const n = alignedReturns(nifty50);

  return {
    symbol: opts.symbol,
    window_days: windowDays,
    annualized_vol: annualizedVolatility(stockReturns),
    max_drawdown_pct: dd?.drawdown_pct ?? null,
    max_drawdown_peak: dd ? prices[dd.peak_idx]?.date ?? null : null,
    max_drawdown_trough: dd ? prices[dd.trough_idx]?.date ?? null : null,
    beta_midcap150: beta(m.stock, m.idx),
    beta_nifty50: beta(n.stock, n.idx),
  };
}

export interface EarningsRow {
  symbol: string;
  event_date: string;
  period: string;
  board_meeting_date: string | null;
  results_pdf_url: string | null;
}

/** Earnings calendar for a single symbol. Recent + upcoming. */
export async function getEarningsCalendar(opts: {
  symbol: string;
  since?: string;
}): Promise<EarningsRow[]> {
  const supabase = getServiceSupabase();
  const since =
    opts.since ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('dim_earnings_event')
    .select('symbol, event_date, period, board_meeting_date, results_pdf_url')
    .eq('symbol', opts.symbol)
    .gte('event_date', since)
    .order('event_date', { ascending: false })
    .limit(40);
  return ((data ?? []) as EarningsRow[]);
}

export interface RelPerfRow {
  date: string;
  rel: number;
}

/**
 * Cumulative relative-performance line: stock log-return minus index
 * log-return, rebased to 0 at the start of the range. Drives the
 * relative-performance chart on the Stock page.
 */
export async function getRelativePerformanceSeries(opts: {
  symbol: string;
  indexName: 'NIFTY_MIDCAP_150' | 'NIFTY_50';
  range: StockRange;
}): Promise<RelPerfRow[]> {
  const supabase = getServiceSupabase();
  const { from, to } = resolveStockRange(opts.range);
  const [sRes, iRes] = await Promise.all([
    supabase
      .from('fct_adjusted_price_daily')
      .select('date, adjusted_close')
      .eq('symbol', opts.symbol)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    supabase
      .from('dim_market_index')
      .select('date, close')
      .eq('index_name', opts.indexName)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ]);
  const stock = ((sRes.data ?? []) as Array<{ date: string; adjusted_close: number | null }>).map(
    (r) => ({ date: r.date, close: r.adjusted_close != null ? Number(r.adjusted_close) : null }),
  );
  const idx = ((iRes.data ?? []) as Array<{ date: string; close: number | null }>).map((r) => ({
    date: r.date,
    close: r.close != null ? Number(r.close) : null,
  }));
  return cumulativeRelativePerformance(stock, idx);
}

// =============================================================================
// Raw-data depth phase (PR 3a) — SB snapshots + decay inputs
// =============================================================================

export interface SBCompanyGrowthRow {
  company: Company;
  asof: string;
  subs_growth: Record<string, number | null>;
  views_growth: Record<string, number | null>;
  total_subscribers: number | null;
  total_views: number | null;
  flagship_grade: string | null;
  flagship_sb_rank: number | null;
}

/**
 * Company-level aggregation of the most-recent SocialBlade snapshot.
 *
 * For each (company, latest_asof_per_channel), sums the per-channel growth
 * windows since growth values are additive. Reports the flagship channel's
 * grade and sb_rank (Tips Official for TIPS, Saregama for SARE) — those
 * single-channel attributes don't aggregate meaningfully via sum.
 */
const FLAGSHIP_CHANNEL: Record<Company, string> = {
  TIPSMUSIC: 'UCJrDMFOdv1I2k8n9oK_V21w',     // Tips Official
  SAREGAMA: 'UC_A7K2dXFsTMAciGmnNxy-Q',       // Saregama (flagship)
};

export async function getSBCompanyGrowth(): Promise<SBCompanyGrowthRow[]> {
  const supabase = getServiceSupabase();
  // Latest snapshot per channel
  const { data } = await supabase
    .from('fct_channel_sb_snapshot')
    .select(
      'channel_id, asof, subs_growth_1, subs_growth_3, subs_growth_7, subs_growth_14, subs_growth_30, subs_growth_60, subs_growth_90, subs_growth_180, subs_growth_365, views_growth_1, views_growth_3, views_growth_7, views_growth_14, views_growth_30, views_growth_60, views_growth_90, views_growth_180, views_growth_365, total_subscribers, total_views, grade, sb_rank',
    )
    .order('asof', { ascending: false });

  type Row = {
    channel_id: string;
    asof: string;
    [k: string]: string | number | null;
  };
  const rows = ((data ?? []) as Row[]) ?? [];
  // Pick latest per channel
  const latestByChannel = new Map<string, Row>();
  for (const r of rows) {
    if (!latestByChannel.has(r.channel_id)) latestByChannel.set(r.channel_id, r);
  }

  // Join channel → company
  const { data: chData } = await supabase
    .from('dim_channel')
    .select('channel_id, company')
    .eq('is_active', true);
  const companyOf = new Map(
    ((chData ?? []) as Array<{ channel_id: string; company: string }>).map((c) => [
      c.channel_id,
      c.company,
    ]),
  );

  const out: SBCompanyGrowthRow[] = [];
  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    const windows: Array<'1' | '3' | '7' | '14' | '30' | '60' | '90' | '180' | '365'> = [
      '1', '3', '7', '14', '30', '60', '90', '180', '365',
    ];
    const subs_growth: Record<string, number | null> = {};
    const views_growth: Record<string, number | null> = {};
    for (const w of windows) {
      subs_growth[w] = 0;
      views_growth[w] = 0;
    }
    let total_subscribers = 0;
    let total_views = 0;
    let any = false;
    let latestAsof = '';
    for (const [cid, row] of latestByChannel) {
      if (companyOf.get(cid) !== company) continue;
      any = true;
      if (row.asof > latestAsof) latestAsof = String(row.asof);
      for (const w of windows) {
        const sv = row[`subs_growth_${w}`];
        const vv = row[`views_growth_${w}`];
        if (typeof sv === 'number') subs_growth[w] = (subs_growth[w] ?? 0) + sv;
        if (typeof vv === 'number') views_growth[w] = (views_growth[w] ?? 0) + vv;
      }
      if (typeof row.total_subscribers === 'number') total_subscribers += row.total_subscribers;
      if (typeof row.total_views === 'number') total_views += row.total_views;
    }
    const flagship = latestByChannel.get(FLAGSHIP_CHANNEL[company]);
    out.push({
      company,
      asof: latestAsof,
      subs_growth,
      views_growth,
      total_subscribers: any ? total_subscribers : null,
      total_views: any ? total_views : null,
      flagship_grade: (flagship?.grade as string | null) ?? null,
      flagship_sb_rank: (flagship?.sb_rank as number | null) ?? null,
    });
  }
  return out;
}

/**
 * Time-series of subs_rank for the flagship channel of a company.
 * Used by peerRankMomentum + the RankTrajectoryStrip UI.
 */
export async function getRankTrajectory(opts: {
  company: Company;
  days?: number;
}): Promise<Array<{ asof: string; subs_rank: number | null; sb_rank: number | null }>> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 180;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const channelId = FLAGSHIP_CHANNEL[opts.company];
  const { data } = await supabase
    .from('fct_channel_sb_snapshot')
    .select('asof, subs_rank, sb_rank')
    .eq('channel_id', channelId)
    .gte('asof', since)
    .order('asof', { ascending: true });
  return ((data ?? []) as Array<{ asof: string; subs_rank: number | null; sb_rank: number | null }>);
}

/**
 * Recent live-premiere event dates for the company's channels.
 * Feeds liveEventDensity().
 */
export async function getLiveEventInputs(opts: {
  company: Company;
  days?: number;
}): Promise<Array<{ event_date: string }>> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data: channels } = await supabase
    .from('dim_channel')
    .select('channel_id')
    .eq('company', opts.company)
    .eq('is_active', true);
  const channelIds = ((channels ?? []) as Array<{ channel_id: string }>).map((c) => c.channel_id);
  if (channelIds.length === 0) return [];
  const { data } = await supabase
    .from('dim_event')
    .select('event_date')
    .eq('event_type', 'live_premiere')
    .in('channel_id', channelIds)
    .gte('event_date', since)
    .order('event_date', { ascending: true });
  return ((data ?? []) as Array<{ event_date: string }>);
}

/**
 * Inputs for the catalog-decay power-law fit: (video_age_days, daily_views)
 * pairs over the last ~90 days of fct_video_daily for the company's videos.
 * Filters to videos published within the last 365 days so the fit isn't
 * dominated by old back-catalog (which has near-zero daily views).
 */
export async function getCatalogDecayInputs(opts: {
  company: Company;
  recentVideoDays?: number;
  factWindowDays?: number;
}): Promise<Array<{ video_age_days: number; daily_views: number }>> {
  const supabase = getServiceSupabase();
  const recentVideoDays = opts.recentVideoDays ?? 365;
  const factWindowDays = opts.factWindowDays ?? 90;
  const videoPublishedSince = new Date(Date.now() - recentVideoDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const factDateSince = new Date(Date.now() - factWindowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: channels } = await supabase
    .from('dim_channel')
    .select('channel_id')
    .eq('company', opts.company)
    .eq('is_active', true);
  const channelIds = ((channels ?? []) as Array<{ channel_id: string }>).map((c) => c.channel_id);
  if (channelIds.length === 0) return [];

  const { data: videos } = await supabase
    .from('dim_video')
    .select('video_id, published_at')
    .in('channel_id', channelIds)
    .gte('published_at', videoPublishedSince);
  const videosTyped = ((videos ?? []) as Array<{ video_id: string; published_at: string }>);
  if (videosTyped.length === 0) return [];

  const videoIds = videosTyped.map((v) => v.video_id);
  const publishedAt = new Map(videosTyped.map((v) => [v.video_id, v.published_at]));

  const { data: facts } = await supabase
    .from('fct_video_daily')
    .select('video_id, date, daily_views')
    .in('video_id', videoIds)
    .gte('date', factDateSince);
  const out: Array<{ video_age_days: number; daily_views: number }> = [];
  for (const r of (facts ?? []) as Array<{
    video_id: string;
    date: string;
    daily_views: number | null;
  }>) {
    if (r.daily_views == null || r.daily_views <= 0) continue;
    const pub = publishedAt.get(r.video_id);
    if (!pub) continue;
    const age =
      (new Date(r.date + 'T00:00:00Z').getTime() - new Date(pub).getTime()) / 86_400_000;
    if (age < 0) continue;
    out.push({ video_age_days: Math.floor(age), daily_views: Number(r.daily_views) });
  }
  return out;
}

// ---- UGC reach (Phase 1: Shorts pivot snapshots) ---------------------------

export interface UGCAnchorRow {
  source_video_id: string;
  source_title: string;
  ugc_count: number;
  ugc_views_sum: number;
  top_ugc_id: string;
  top_ugc_views: number;
}

export interface UGCReachSnapshot {
  company: Company;
  latestAsof: string | null;
  priorAsof: string | null;
  snapshotsAvailable: number;
  ugc_shorts_count: number;
  attributed_views: number;
  // WoW delta (latest minus prior snapshot); null when only one snapshot exists.
  weekOverWeek: { delta_views: number; pct: number } | null;
  topAnchors: UGCAnchorRow[];
}

/**
 * Aggregate the most recent fct_ugc_short_match snapshot into a per-company
 * reach summary, plus week-over-week deltas when ≥ 2 snapshots exist.
 *
 * Filters to anchors whose source channel belongs to the requested company
 * (via dim_channel.company). Topic/OAC channels with NULL company are
 * naturally excluded.
 */
export async function getUGCReach(opts: { company: Company }): Promise<UGCReachSnapshot> {
  const supabase = getServiceSupabase();

  // 1) Channels of this company
  const { data: chans } = await supabase
    .from('dim_channel')
    .select('channel_id')
    .eq('company', opts.company)
    .eq('channel_type', 'owned');
  const chanIds = ((chans ?? []) as Array<{ channel_id: string }>).map((c) => c.channel_id);
  if (chanIds.length === 0) return emptySnapshot(opts.company);

  // 2) Videos in those channels
  const { data: vids } = await supabase
    .from('dim_video')
    .select('video_id, title')
    .in('channel_id', chanIds);
  const vidsTyped = (vids ?? []) as Array<{ video_id: string; title: string }>;
  if (vidsTyped.length === 0) return emptySnapshot(opts.company);
  const titleByVid = new Map(vidsTyped.map((v) => [v.video_id, v.title]));
  const vidIds = vidsTyped.map((v) => v.video_id);

  // 3) Two most recent asof dates that have rows for any of our anchors
  const { data: asofRows } = await supabase
    .from('fct_ugc_short_match')
    .select('asof')
    .in('source_video_id', vidIds)
    .order('asof', { ascending: false })
    .limit(1000);
  const asofs = Array.from(
    new Set(((asofRows ?? []) as Array<{ asof: string }>).map((r) => r.asof)),
  );
  if (asofs.length === 0) return emptySnapshot(opts.company);
  const latestAsof = asofs[0];
  const priorAsof = asofs[1] ?? null;

  // 4) All matches for latest + (optional) prior asof
  const fetchAsof = async (asof: string) => {
    const out: Array<{
      source_video_id: string;
      ugc_video_id: string;
      view_count: number | null;
    }> = [];
    for (let i = 0; i < vidIds.length; i += 200) {
      const slice = vidIds.slice(i, i + 200);
      const { data } = await supabase
        .from('fct_ugc_short_match')
        .select('source_video_id, ugc_video_id, view_count')
        .in('source_video_id', slice)
        .eq('asof', asof);
      out.push(
        ...((data ?? []) as Array<{
          source_video_id: string;
          ugc_video_id: string;
          view_count: number | null;
        }>),
      );
    }
    return out;
  };

  const latestRows = await fetchAsof(latestAsof);
  const priorRows = priorAsof ? await fetchAsof(priorAsof) : [];

  // 5) Aggregate latest snapshot
  const totalViewsLatest = latestRows.reduce((acc, r) => acc + (r.view_count ?? 0), 0);
  const totalCountLatest = latestRows.length;

  // 6) Per-anchor breakdown for the latest snapshot
  type Agg = { count: number; views: number; topUgc: string; topViews: number };
  const byAnchor = new Map<string, Agg>();
  for (const r of latestRows) {
    const v = r.view_count ?? 0;
    const bucket = byAnchor.get(r.source_video_id) ?? {
      count: 0,
      views: 0,
      topUgc: r.ugc_video_id,
      topViews: 0,
    };
    bucket.count += 1;
    bucket.views += v;
    if (v > bucket.topViews) {
      bucket.topViews = v;
      bucket.topUgc = r.ugc_video_id;
    }
    byAnchor.set(r.source_video_id, bucket);
  }

  const topAnchors: UGCAnchorRow[] = [...byAnchor.entries()]
    .map(([source_video_id, a]) => ({
      source_video_id,
      source_title: titleByVid.get(source_video_id) ?? source_video_id,
      ugc_count: a.count,
      ugc_views_sum: a.views,
      top_ugc_id: a.topUgc,
      top_ugc_views: a.topViews,
    }))
    .sort((a, b) => b.ugc_views_sum - a.ugc_views_sum)
    .slice(0, 5);

  // 7) WoW delta on attributed views
  let weekOverWeek: UGCReachSnapshot['weekOverWeek'] = null;
  if (priorAsof && priorRows.length > 0) {
    const totalViewsPrior = priorRows.reduce((acc, r) => acc + (r.view_count ?? 0), 0);
    const delta = totalViewsLatest - totalViewsPrior;
    const pct = totalViewsPrior > 0 ? delta / totalViewsPrior : 0;
    weekOverWeek = { delta_views: delta, pct };
  }

  return {
    company: opts.company,
    latestAsof,
    priorAsof,
    snapshotsAvailable: asofs.length,
    ugc_shorts_count: totalCountLatest,
    attributed_views: totalViewsLatest,
    weekOverWeek,
    topAnchors,
  };
}

function emptySnapshot(company: Company): UGCReachSnapshot {
  return {
    company,
    latestAsof: null,
    priorAsof: null,
    snapshotsAvailable: 0,
    ugc_shorts_count: 0,
    attributed_views: 0,
    weekOverWeek: null,
    topAnchors: [],
  };
}
