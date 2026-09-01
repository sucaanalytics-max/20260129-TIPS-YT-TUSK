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
  demandMomentum,
  type SignalCell,
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
import { buildCorrelationMatrix } from '@/lib/correlation-matrix';
import { resolveStockRange, type StockRange } from '@/lib/stock-range';
import {
  estimateConsolidatedYT,
  estimateOwnedRevenue,
  estimateStreamingRoyalty,
  estimateTopicRevenue,
  estimateUgcRevenue,
  type RevenueCpmBand,
  type RevenueEstimate,
} from '@/lib/revenue-cpm';
import { aggregateUgcReach, type UgcVideoMeta } from '@/lib/ugc-aggregate';
import {
  computeRoyaltyCrossCheck,
  rollupAppProxySeries,
  type AppProxyPoint,
  type RoyaltyCrossCheck,
} from '@/lib/demand';
import { buildControlChart, type ControlChart } from '@/lib/control-chart';
import type { ExplorerMetric } from '@/lib/metrics';
import {
  comparePeriods,
  REGIME_BREAK,
  type Granularity,
  type PeriodComparison,
} from '@/lib/period-compare';
import {
  lagCorrelate,
  alignedLogReturns,
  criticalR,
  pValue,
  type LagResult,
} from '@/lib/correlation';
import { fiscalQuarterOf, quarterProgress, type FiscalQuarter } from '@/lib/fiscal';
import {
  computeNowcast,
  DEFAULT_ASSUMPTIONS,
  type NowcastAssumptions,
  type NowcastDrivers,
} from '@/lib/nowcast';
import {
  imputePerChannel,
  imputeByDayCoverage,
  type ChannelDayReading,
} from '@/lib/nowcast-coverage';
import { scoreEstimate, summariseTrackRecord, type ScoredQuarter, type TrackRecord } from '@/lib/scoring';
import { TARGET_LINE_ITEM } from '@/lib/financials';
import {
  bucketWeekly,
  trimPartialEdges,
  buildReachBand,
  type DailyPoint,
} from '@/lib/total-reach';

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

export interface DataQualityDay {
  date: string;
  company: string | null;
  channels_affected: number;
  max_span_days: number;
}

export interface DataQualitySnapshot {
  since: string;
  days: DataQualityDay[];
  imputed_channel_days: number;
  unresolved_channels: number; // frozen right now, awaiting the next good reading
}

/**
 * Where the view series has been repaired rather than measured.
 *
 * YouTube intermittently serves a stale cumulative viewCount; when it unfreezes
 * the backlog is spread back over the days it covered (lib/view-delta.ts). Those
 * days are real in total but interpolated per-day, and this is the panel that
 * says so out loud rather than letting a smoothed line pass as measured.
 */
export async function getDataQuality(opts: { days?: number } = {}): Promise<DataQualitySnapshot> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 90;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: imputedRows }, { data: channelRows }, { data: frozenRows }] = await Promise.all([
    supabase
      .from('fct_channel_daily')
      .select('channel_id, date, delta_span_days')
      .eq('daily_views_imputed', true)
      .gte('date', since)
      .order('date', { ascending: false })
      .limit(4000),
    supabase.from('dim_channel').select('channel_id, company, channel_type'),
    supabase
      .from('fct_channel_daily')
      .select('channel_id')
      .is('daily_views', null)
      .eq('date', today),
  ]);

  const companyBy = new Map(
    ((channelRows ?? []) as Array<{ channel_id: string; company: string | null; channel_type: string }>)
      .map((c) => [c.channel_id, c.company]),
  );

  type Row = { channel_id: string; date: string; delta_span_days: number | null };
  const byKey = new Map<string, DataQualityDay>();
  for (const r of (imputedRows ?? []) as Row[]) {
    const company = companyBy.get(r.channel_id) ?? null;
    const key = `${r.date}|${company ?? '-'}`;
    const cur = byKey.get(key) ?? {
      date: r.date,
      company,
      channels_affected: 0,
      max_span_days: 0,
    };
    cur.channels_affected += 1;
    cur.max_span_days = Math.max(cur.max_span_days, Number(r.delta_span_days ?? 0));
    byKey.set(key, cur);
  }

  const daysOut = [...byKey.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || (a.company ?? '').localeCompare(b.company ?? ''),
  );

  return {
    since,
    days: daysOut,
    imputed_channel_days: (imputedRows ?? []).length,
    unresolved_channels: (frozenRows ?? []).length,
  };
}

// ---- Explorer / analysis layer ---------------------------------------------

export type { ExplorerMetric } from '@/lib/metrics';

export interface ExplorerRow {
  date: string;
  company: Company;
  views: number | null;
  subscribers: number | null;
  releases: number | null;
  channels: number;
  imputed: number;
  /** False before REGIME_BREAK — the row is a single legacy aggregate and cannot be sliced by channel. */
  sliceable: boolean;
}

/**
 * The explorer's base grain: one row per company per day, all three metrics.
 *
 * `sliceable` is the important field. Before 2026-02-16 the series is a single
 * synthetic aggregate row per day, so a channel filter has nothing to bite on;
 * the UI disables that control for such ranges rather than returning an empty
 * table and letting the reader conclude the catalogue went quiet.
 */
export async function getExplorerRows(opts: {
  from?: string;
  to?: string;
  companies?: Company[];
} = {}): Promise<ExplorerRow[]> {
  const supabase = getServiceSupabase();
  const to = opts.to ?? new Date().toISOString().slice(0, 10);
  const from = opts.from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  let q = supabase
    .from('v_company_daily')
    .select('date, company, daily_views, daily_subscribers, daily_videos, channels_with_data, imputed_channels')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .limit(5000);
  if (opts.companies?.length) q = q.in('company', opts.companies);

  const { data } = await q;
  return ((data ?? []) as Array<{
    date: string; company: Company;
    daily_views: number | null; daily_subscribers: number | null; daily_videos: number | null;
    channels_with_data: number | null; imputed_channels: number | null;
  }>).map((r) => ({
    date: r.date,
    company: r.company,
    views: r.daily_views == null ? null : Number(r.daily_views),
    subscribers: r.daily_subscribers == null ? null : Number(r.daily_subscribers),
    releases: r.daily_videos == null ? null : Number(r.daily_videos),
    channels: Number(r.channels_with_data ?? 0),
    imputed: Number(r.imputed_channels ?? 0),
    sliceable: r.date >= REGIME_BREAK,
  }));
}

export interface PeriodComparisonSet {
  company: Company;
  metric: ExplorerMetric;
  granularity: Granularity;
  periods: PeriodComparison[];
}

/** Quarter- or year-over-period totals per company, each carrying its regime. */
export async function getPeriodComparisons(opts: {
  metric: ExplorerMetric;
  granularity: Granularity;
  companies?: Company[];
}): Promise<PeriodComparisonSet[]> {
  const rows = await getExplorerRows({ from: '2023-01-01', companies: opts.companies });
  const companies = [...new Set(rows.map((r) => r.company))].sort();
  return companies.map((company) => ({
    company,
    metric: opts.metric,
    granularity: opts.granularity,
    periods: comparePeriods(
      rows.filter((r) => r.company === company).map((r) => ({ date: r.date, value: r[opts.metric] })),
      opts.granularity,
    ),
  }));
}

export interface ControlChartResult {
  company: Company;
  metric: ExplorerMetric;
  from: string;
  to: string;
  chart: ControlChart;
}

export async function getControlChart(opts: {
  company: Company;
  metric: ExplorerMetric;
  days?: number;
  windows?: number[];
}): Promise<ControlChartResult> {
  const days = opts.days ?? 110;
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await getExplorerRows({ from, companies: [opts.company] });
  const points = rows.map((r) => ({ date: r.date, value: r[opts.metric] }));
  return {
    company: opts.company,
    metric: opts.metric,
    from: points[0]?.date ?? from,
    to: points[points.length - 1]?.date ?? from,
    chart: buildControlChart(points, opts.windows ?? [15, 30, 45, 90]),
  };
}

export interface LagCorrelationSet {
  company: Company;
  metric: ExplorerMetric;
  lags: LagResult[];
  /** |r| needed for nominal 5% significance at this n. */
  critical: number;
  /** Lags clearing `critical` before any multiple-comparison correction. */
  nominallySignificant: number;
  best: { lag: number; r: number; p: number } | null;
}

/**
 * Metric-vs-price correlation at lags −7..+7, against daily LOG RETURNS.
 *
 * Levels are deliberately not used: two trending series correlate with almost
 * anything. Callers should render `critical` as a threshold and report how many
 * lags clear it against how many chance alone predicts (lags × 0.05).
 */
/**
 * The full reach-against-price grid: every metric, for both companies, against
 * BOTH share prices.
 *
 * The cross-company pairs are the point, not padding. They are the control: if
 * Tips' views track Saregama's price about as well as they track Tips' own,
 * whatever is there is a market factor rather than anything about the
 * catalogue. Computing only the same-company cells would leave no way to tell
 * those apart.
 */
export async function getCorrelationMatrix(opts: {
  days?: number;
  lags?: number[];
  alpha?: number;
} = {}): Promise<import('@/lib/correlation-matrix').MatrixResult & { windowDays: number; from: string }> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 365;
  const lags = opts.lags ?? Array.from({ length: 15 }, (_, i) => i - 7);
  // Pad the fetch so the earliest lag still has a partner to pair with.
  const from = new Date(Date.now() - (days + 30) * 86_400_000).toISOString().slice(0, 10);

  const [rows, { data: priceRows }] = await Promise.all([
    getExplorerRows({ from }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('symbol, date, adjusted_close')
      .gte('date', from)
      .order('date', { ascending: true })
      .limit(5000),
  ]);

  const prices = (priceRows ?? []) as Array<{
    symbol: Company;
    date: string;
    adjusted_close: number | null;
  }>;

  /*
   * Both reads are capped (5000 explorer rows, 5000 price rows). At today's
   * window that is ~790 and ~800, but a silently truncated series would shorten
   * one side of every pair and quietly bias every correlation in the grid —
   * with no symptom on screen. Fail loudly instead.
   */
  if (prices.length >= 5000) {
    throw new Error(
      `getCorrelationMatrix: price read hit its 5000-row cap for a ${days}-day window. ` +
        `Page the read rather than correlating a truncated series.`,
    );
  }
  if (rows.length >= 5000) {
    throw new Error(
      `getCorrelationMatrix: explorer read hit its 5000-row cap for a ${days}-day window. ` +
        `Page the read rather than correlating a truncated series.`,
    );
  }

  const symbols = [...new Set(prices.map((p) => p.symbol))].sort();
  const returns = symbols.map((symbol) => {
    const px = prices.filter((p) => p.symbol === symbol);
    const rets = alignedLogReturns(
      px.map((p) => (p.adjusted_close == null ? null : Number(p.adjusted_close))),
    );
    return { symbol, points: px.map((p, i) => ({ date: p.date, value: rets[i] })) };
  });

  const companies = [...new Set(rows.map((r) => r.company))].sort();
  const series = companies.flatMap((company) =>
    (['views', 'subscribers', 'releases'] as ExplorerMetric[]).map((metric) => ({
      company,
      metric,
      points: rows
        .filter((r) => r.company === company)
        .map((r) => ({ date: r.date, value: r[metric] })),
    })),
  );

  const result = buildCorrelationMatrix({ series, returns, lags, alpha: opts.alpha });
  return { ...result, windowDays: days, from };
}

export async function getLagCorrelations(opts: {
  days?: number;
  lags?: number[];
} = {}): Promise<LagCorrelationSet[]> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 110;
  const lags = opts.lags ?? Array.from({ length: 15 }, (_, i) => i - 7);
  const from = new Date(Date.now() - (days + 20) * 86_400_000).toISOString().slice(0, 10);

  const [rows, { data: priceRows }] = await Promise.all([
    getExplorerRows({ from }),
    supabase
      .from('fct_adjusted_price_daily')
      .select('symbol, date, adjusted_close')
      .gte('date', from)
      .order('date', { ascending: true })
      .limit(2000),
  ]);

  const prices = (priceRows ?? []) as Array<{ symbol: Company; date: string; adjusted_close: number | null }>;
  const out: LagCorrelationSet[] = [];

  for (const company of [...new Set(rows.map((r) => r.company))].sort()) {
    const px = prices.filter((p) => p.symbol === company);
    const rets = alignedLogReturns(px.map((p) => (p.adjusted_close == null ? null : Number(p.adjusted_close))));
    const retSeries = px.map((p, i) => ({ date: p.date, value: rets[i] }));

    for (const metric of ['views', 'subscribers', 'releases'] as ExplorerMetric[]) {
      const metricSeries = rows
        .filter((r) => r.company === company)
        .map((r) => ({ date: r.date, value: r[metric] }));
      const results = lagCorrelate(metricSeries, retSeries, lags);
      const maxN = Math.max(0, ...results.map((r) => r.n));
      const critical = maxN >= 4 ? criticalR(maxN) : 1;
      const scored = results.filter((r) => r.r != null);
      const best = scored.reduce<{ lag: number; r: number; p: number } | null>((acc, cur) => {
        const r = cur.r as number;
        return acc == null || Math.abs(r) > Math.abs(acc.r)
          ? { lag: cur.lag, r, p: pValue(r, cur.n) }
          : acc;
      }, null);
      out.push({
        company,
        metric,
        lags: results,
        critical,
        nominallySignificant: scored.filter((r) => Math.abs(r.r as number) > critical).length,
        best,
      });
    }
  }
  return out;
}

// ---- Nowcast spine ---------------------------------------------------------

/**
 * How far back topic attribution can be read. Matches the retention the
 * attribution snapshot actually covers; asking beyond it returns an empty
 * series, which would read as "no topic reach" rather than "unknown".
 */
const TOPIC_LOOKBACK_LIMIT_DAYS = 120;

/**
 * Quarter-to-date reach per driver.
 *
 * Owned views come from v_company_daily. Topic reuses the existing
 * getTopicReach snapshot rather than recomputing attribution — one definition
 * of attributed reach, not two.
 */
export async function getNowcastDrivers(opts: {
  company: Company;
  from: string;
  to: string;
}): Promise<NowcastDrivers> {
  const supabase = getServiceSupabase();

  /*
   * getTopicReach looks back N days from TODAY, not from opts.from. A fixed
   * window would therefore return nothing for a quarter that starts outside it
   * and quietly report topicViews = 0 — a wrong number, not a missing one, and
   * the estimate would still be stored. So size the window to the request and
   * refuse one we cannot cover.
   */
  const daysBack = Math.ceil((Date.now() - Date.parse(`${opts.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(daysBack) || daysBack < 1) {
    throw new Error(`getNowcastDrivers: cannot read a topic window from '${opts.from}'`);
  }
  if (daysBack > TOPIC_LOOKBACK_LIMIT_DAYS) {
    throw new Error(
      `getNowcastDrivers: ${opts.from} is ${daysBack} days back, beyond the ${TOPIC_LOOKBACK_LIMIT_DAYS}-day ` +
        `topic-attribution window. Backfilling that far would report topicViews = 0 rather than fail.`,
    );
  }

  const elapsedDays =
    Math.round(
      (Date.parse(`${opts.to}T00:00:00Z`) - Date.parse(`${opts.from}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 1) {
    throw new Error(
      `getNowcastDrivers: '${opts.from}'..'${opts.to}' is not a usable window (${elapsedDays} days)`,
    );
  }

  const [{ data: ownedChans }, topic] = await Promise.all([
    supabase
      .from('dim_channel')
      .select('channel_id')
      .eq('company', opts.company)
      .eq('channel_type', 'owned')
      .eq('is_active', true),
    getTopicReach({ company: opts.company, days: daysBack }),
  ]);

  const ownedChannelIds = ((ownedChans ?? []) as Array<{ channel_id: string }>).map(
    (c) => c.channel_id,
  );
  if (ownedChannelIds.length === 0) {
    throw new Error(
      `getNowcastDrivers: no active owned channels for ${opts.company}. ` +
        `Refusing to report zero reach as a measurement.`,
    );
  }

  /*
   * Read the owned leg PER CHANNEL rather than from v_company_daily.
   *
   * v_company_daily is `sum(f.daily_views) ... GROUP BY date, company`, and
   * Postgres sum() SKIPS NULLs. On a day where some channels are frozen and
   * some report, the view therefore returns a NON-NULL PARTIAL total, which
   * the old day-level imputation counted as a fully observed day — so coverage
   * read 1.0 and nothing was imputed, missing exactly the frozen-channel case
   * the imputation was written for. The view's channels_with_data cannot fix
   * that either: it is count(DISTINCT channel_id), and a frozen channel still
   * has a row, so it does not fall when a channel's daily_views goes NULL.
   *
   * Per-channel rows show the NULLs directly, and they let each channel be
   * imputed at ITS OWN mean. That matters because owned channels are wildly
   * unequal: scaling a company total by 16/15 when the missing channel is the
   * largest one would be badly wrong in a way a channel-count ratio cannot see.
   *
   * The channel set is dim_channel's active owned channels — the same set
   * v_company_daily's primary branch aggregates. The view's secondary branch
   * (inactive channels, used only on days when NO active channel reported) is
   * deliberately not reproduced: such a day is a company-wide outage, and
   * imputing it from a different roster would be a discontinuity, not a
   * measurement.
   */
  const ownedReadings: ChannelDayReading[] = [];
  const PAGE = 1000;
  const MAX_PAGES = 40; // 25 channels x 92 days ~ 2,300 rows; 40k is head-room
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `getNowcastDrivers: owned channel-day read for ${opts.company} exceeded ${MAX_PAGES * PAGE} rows — ` +
          `refusing to silently truncate the window`,
      );
    }
    const { data, error } = await supabase
      .from('fct_channel_daily')
      // delta_span_days and daily_views_imputed are load-bearing, not extras:
      // 0026 can leave one row carrying several days of views, and counting
      // such a row as a single observed day over-imputes the shortfall.
      .select('channel_id, date, daily_views, delta_span_days, daily_views_imputed')
      .in('channel_id', ownedChannelIds)
      .gte('date', opts.from)
      .lte('date', opts.to)
      // Total ordering, so paging can neither repeat nor skip a row.
      .order('date', { ascending: true })
      .order('channel_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      throw new Error(`getNowcastDrivers: owned channel-day read failed — ${error.message}`);
    }
    const rows = (data ?? []) as Array<{
      channel_id: string;
      date: string;
      daily_views: number | null;
      delta_span_days: number | null;
      daily_views_imputed: boolean | null;
    }>;
    for (const r of rows) {
      ownedReadings.push({
        channelId: r.channel_id,
        date: r.date,
        value: r.daily_views == null ? null : Number(r.daily_views),
        spanDays: r.delta_span_days == null ? null : Number(r.delta_span_days),
        imputed: r.daily_views_imputed === true,
      });
    }
    if (rows.length < PAGE) break;
  }

  /*
   * Impute the gap rather than letting it read as zero.
   *
   * Not every elapsed day carries a value: YouTube freezes cumulative counts
   * (~4.7% of channel-days), the repair leaves a genuinely unresolvable day
   * NULL, and some days are missing from the table entirely. Summing what
   * exists and then dividing by CALENDAR progress silently treats each of
   * those unknown days as a zero-view day. Measured on FY27 Q2 at 2026-08-31:
   * 54 of 62 elapsed days carried a company-level value, so the estimate came
   * out ~13% low — and the frozen single channels on top of that were invisible.
   *
   * A missing channel-day is unknown, not empty, so it is imputed at that
   * channel's own observed daily mean. Where coverage is complete this is a
   * no-op. `observedDays` below counts only days on which EVERY reporting
   * channel reported a MEASURED value; a day made whole by a spread catch-up
   * is counted separately as `imputedDays`, because 0026's own column comment
   * says such a value must never be presented as measured.
   */
  const ownedCoverage = imputePerChannel({
    readings: ownedReadings,
    channelIds: ownedChannelIds,
    elapsedDays,
  });
  if (!ownedCoverage) {
    throw new Error(
      `getNowcastDrivers: no usable owned-view reading for ${opts.company} in ${opts.from}..${opts.to} ` +
        `across ${ownedChannelIds.length} active owned channels. ` +
        `Refusing to report zero reach as a measurement.`,
    );
  }
  const ownedViews = ownedCoverage.views;
  const observedDays = ownedCoverage.observedDays;

  /*
   * The topic leg gets the SAME treatment, and the same refusal.
   *
   * Two failures used to hide here. First, getTopicReach returns an empty
   * snapshot whenever its attribution inputs are missing (no catalog_share
   * rows, or no active topic channels for those artists) — that made
   * topicViews 0, dropped the band ~28%, and the estimate was still stored
   * with nothing in ops_error_log. The owned leg has always refused to report
   * zero reach as a measurement; the topic leg now refuses too. Genuinely zero
   * attributed reach on channels that DID report is still a measurement and is
   * allowed through as 0 — only missing inputs are an error.
   *
   * Second, the series was summed over whatever days happened to be present
   * and then extrapolated by CALENDAR progress — precisely the bug the owned
   * leg was fixed for, worth ~13% on the leg and ~3.6% on the whole band.
   *
   * The snapshot is a day-level aggregate, so the topic leg can only be scaled
   * by each day's channel shortfall, which assumes the absent channels are of
   * average size. That is weaker than the owned leg's per-channel imputation,
   * and tolerable here only because topic reach is spread over many comparable
   * channels rather than a handful of very unequal ones.
   */
  if (topic.channelsTracked === 0) {
    throw new Error(
      `getNowcastDrivers: no Topic/OAC attribution inputs for ${opts.company} — dim_artist_label has no ` +
        `catalog_share rows, or dim_channel has no active topic channels for those artists. The topic leg is ` +
        `~28% of the band; refusing to report missing attribution as zero reach.`,
    );
  }
  const topicCoverage = imputeByDayCoverage({
    // TopicReachSnapshot exposes a daily `series`, not a period total — take
    // the days inside this quarter rather than reusing totals.last_30d, which
    // is a rolling window and would not line up with the quarter boundary.
    days: topic.series
      .filter((d) => d.date >= opts.from && d.date <= opts.to)
      .map((d) => ({
        date: d.date,
        value: d.attributed_daily_views,
        channelsReporting: d.channels_reporting,
        channelDaysCovered: d.channel_days_covered,
      })),
    elapsedDays,
  });
  if (!topicCoverage) {
    throw new Error(
      `getNowcastDrivers: ${opts.company} tracks ${topic.channelsTracked} Topic/OAC channels but not one ` +
        `carried an attributed reading in ${opts.from}..${opts.to}. Missing attribution inputs are not ` +
        `zero reach; refusing to report them as zero.`,
    );
  }
  const topicViews = topicCoverage.views;

  /*
   * UGC is deliberately not read at all. Its reach is a CUMULATIVE discovered
   * figure, not a per-quarter flow, so extrapolating it by quarter progress
   * would inflate the estimate by roughly 1/progress. An earlier draft fetched
   * getUGCReach and discarded the result, which cost a multi-query round trip
   * per company per run against a 120s cron budget for no effect on the output.
   * `includeUgc` stays in the model for when UGC is measured as a flow.
   */
  // Both legs are rounded by the imputers: a fractional view does not exist,
  // and these are written to fct_revenue_nowcast.drivers as jsonb.
  return { ownedViews, topicViews, ugcViews: 0, observedDays, elapsedDays };
}

/**
 * Preconditions mirroring the CHECK constraints on fct_revenue_nowcast:
 *   band_low_inr <= band_mid_inr <= band_high_inr
 *   quarter_progress > 0 AND quarter_progress <= 1
 *
 * Both are reachable from bad input — a caller-supplied CPM band in the wrong
 * order, or an `asof` that does not parse as a date — and a constraint
 * violation would surface inside a cron as an opaque Postgres error naming a
 * constraint rather than the assumption that broke it. Fail here instead, so
 * the row is never sent and the message says what was wrong.
 */
function assertStorableNowcast(row: {
  band_low_inr: number;
  band_mid_inr: number;
  band_high_inr: number;
  projected_views: number;
  quarter_progress: number;
}): void {
  const numbers: Array<[string, number]> = [
    ['band_low_inr', row.band_low_inr],
    ['band_mid_inr', row.band_mid_inr],
    ['band_high_inr', row.band_high_inr],
    ['projected_views', row.projected_views],
    ['quarter_progress', row.quarter_progress],
  ];
  for (const [name, value] of numbers) {
    if (!Number.isFinite(value)) throw new Error(`storeNowcast: ${name} is not finite (${value})`);
  }
  if (!(row.quarter_progress > 0 && row.quarter_progress <= 1)) {
    throw new Error(
      `storeNowcast: quarter_progress ${row.quarter_progress} outside (0, 1] — asof must be a real date inside its own quarter`,
    );
  }
  if (!(row.band_low_inr <= row.band_mid_inr && row.band_mid_inr <= row.band_high_inr)) {
    throw new Error(
      `storeNowcast: band out of order (low ${row.band_low_inr}, mid ${row.band_mid_inr}, high ${row.band_high_inr}) — check the CPM assumptions`,
    );
  }
}

/** Append today's estimate. Idempotent per (company, quarter, asof). */
export async function storeNowcast(opts: {
  company: Company;
  asof: string;
  assumptions?: NowcastAssumptions;
  ingestRunId?: number;
}): Promise<{ fiscal: FiscalQuarter; mid: number }> {
  const supabase = getServiceSupabase();
  const fiscal = fiscalQuarterOf(opts.asof);
  const assumptions = opts.assumptions ?? DEFAULT_ASSUMPTIONS;

  const drivers = await getNowcastDrivers({
    company: opts.company,
    from: fiscal.start,
    to: opts.asof,
  });
  const result = computeNowcast({
    drivers,
    assumptions,
    quarterProgress: quarterProgress(opts.asof),
  });

  const row = {
    company: opts.company,
    fiscal_label: fiscal.label,
    asof: opts.asof,
    band_low_inr: Math.round(result.band.low),
    band_mid_inr: Math.round(result.band.mid),
    band_high_inr: Math.round(result.band.high),
    projected_views: Math.round(result.projectedViews),
    quarter_progress: result.quarterProgress,
    drivers,
    assumptions,
    ingest_run_id: opts.ingestRunId ?? null,
  };
  assertStorableNowcast(row);

  const { error } = await supabase
    .from('fct_revenue_nowcast')
    .upsert(row, { onConflict: 'company,fiscal_label,asof' });
  if (error) throw new Error(`storeNowcast upsert: ${error.message}`);
  return { fiscal, mid: result.band.mid };
}

/**
 * Score every quarter where a CONFIRMED actual exists and a pre-print estimate
 * was made. Unconfirmed financials are excluded — a misparsed line would poison
 * the record permanently.
 */
/**
 * Everything the front page says about one company.
 *
 * Deliberately tolerant of an empty nowcast table: until the cron has run for
 * the first time there is no band, and the page must say so rather than render
 * a zero. `band: null` is the honest state, not an error.
 */
export interface NowcastHeadline {
  company: Company;
  fiscal: FiscalQuarter;
  quarterProgress: number;
  /** Null until the nowcast cron has stored an estimate for this quarter. */
  band: { low: number; mid: number; high: number; asof: string } | null;
  /** The most recent quarter actually reported, and what it printed. */
  lastPrinted: { fiscalLabel: string; valueInr: number } | null;
  /** Year-on-year change on lastPrinted, as a fraction. Null when the year-ago quarter is absent. */
  yoy: number | null;
  fullYear: { fiscalLabel: string; valueInr: number } | null;
  trackRecord: TrackRecord;
}

export async function getNowcastHeadline(
  company: Company,
  asof: string,
): Promise<NowcastHeadline> {
  const supabase = getServiceSupabase();
  const fiscal = fiscalQuarterOf(asof);

  const [{ data: latest }, { data: reported }, trackRecord] = await Promise.all([
    supabase
      .from('fct_revenue_nowcast')
      .select('asof, band_low_inr, band_mid_inr, band_high_inr')
      .eq('company', company)
      .eq('fiscal_label', fiscal.label)
      .order('asof', { ascending: false })
      .limit(1),
    /*
     * CONFIRMED rows only, matching getTrackRecord and what migration 0027
     * mandates. fct_reported_financials deliberately allows an unconfirmed row
     * (extraction_method 'pdf'/'api', confirmed_by NULL) so a filing can be
     * ingested before a human has checked it. Without this filter a misparsed
     * figure would print on the front page as "Last printed", set the YoY
     * numerator AND denominator, and set the full-year line — while the track
     * record nine lines below, which does filter, ignored it. One screen, two
     * answers about what has been reported, with the unchecked number in the
     * more prominent position. An unconfirmed figure renders as the em dash
     * the components already handle; that is the honest state.
     */
    supabase
      .from('fct_reported_financials')
      .select('fiscal_label, value_inr')
      .eq('company', company)
      .eq('line_item', TARGET_LINE_ITEM[company])
      .not('confirmed_by', 'is', null),
    getTrackRecord(company),
  ]);

  const rows = (reported ?? []) as Array<{ fiscal_label: string; value_inr: number }>;
  const byLabel = new Map(rows.map((r) => [r.fiscal_label, Number(r.value_inr)]));

  // Quarterly labels carry a "Qn" suffix; a bare "FY26" is the full year. Sorting
  // the quarterly labels lexically is safe because the format is fixed-width.
  const quarterly = rows.filter((r) => / Q[1-4]$/.test(r.fiscal_label)).sort((a, b) =>
    a.fiscal_label < b.fiscal_label ? 1 : -1,
  );
  const last = quarterly[0] ?? null;

  let yoy: number | null = null;
  let lastPrinted: NowcastHeadline['lastPrinted'] = null;
  if (last) {
    lastPrinted = { fiscalLabel: last.fiscal_label, valueInr: Number(last.value_inr) };
    const m = /^FY(\d{2}) Q([1-4])$/.exec(last.fiscal_label);
    if (m) {
      const prior = byLabel.get(`FY${String(Number(m[1]) - 1).padStart(2, '0')} Q${m[2]}`);
      // Guard the denominator: a zero prior year would make yoy infinite, which
      // would render as a nonsense percentage rather than an absent one.
      if (prior !== undefined && prior > 0) yoy = (lastPrinted.valueInr - prior) / prior;
    }
  }

  const fullYearRow = rows
    .filter((r) => /^FY\d{2}$/.test(r.fiscal_label))
    .sort((a, b) => (a.fiscal_label < b.fiscal_label ? 1 : -1))[0];

  const b = ((latest ?? []) as Array<{
    asof: string; band_low_inr: number; band_mid_inr: number; band_high_inr: number;
  }>)[0];

  return {
    company,
    fiscal,
    quarterProgress: quarterProgress(asof),
    band: b
      ? {
          low: Number(b.band_low_inr),
          mid: Number(b.band_mid_inr),
          high: Number(b.band_high_inr),
          asof: b.asof,
        }
      : null,
    lastPrinted,
    yoy,
    fullYear: fullYearRow
      ? { fiscalLabel: fullYearRow.fiscal_label, valueInr: Number(fullYearRow.value_inr) }
      : null,
    trackRecord,
  };
}

/**
 * The nowcast recomputed live from today's drivers, so /drivers shows the
 * working rather than the stored answer. The cron's row is the record; this is
 * the derivation, and the two agreeing is itself a useful check.
 */
export async function getNowcastBreakdown(
  company: Company,
  asof: string,
  assumptions: NowcastAssumptions = DEFAULT_ASSUMPTIONS,
): Promise<{
  fiscal: FiscalQuarter;
  drivers: NowcastDrivers;
  assumptions: NowcastAssumptions;
  result: ReturnType<typeof computeNowcast>;
}> {
  const fiscal = fiscalQuarterOf(asof);
  const drivers = await getNowcastDrivers({ company, from: fiscal.start, to: asof });
  const result = computeNowcast({
    drivers,
    assumptions,
    quarterProgress: quarterProgress(asof),
  });
  return { fiscal, drivers, assumptions, result };
}

export async function getTrackRecord(company: Company): Promise<TrackRecord> {
  const supabase = getServiceSupabase();
  const [{ data: actuals }, { data: estimates }] = await Promise.all([
    supabase
      .from('fct_reported_financials')
      .select('fiscal_label, value_inr')
      .eq('company', company)
      .eq('line_item', TARGET_LINE_ITEM[company])
      .not('confirmed_by', 'is', null),
    supabase
      .from('fct_revenue_nowcast')
      .select('fiscal_label, asof, band_low_inr, band_mid_inr, band_high_inr')
      .eq('company', company)
      .order('asof', { ascending: true }),
  ]);

  // The estimate that counts is the last one made before the quarter closed.
  const lastByQuarter = new Map<string, { low: number; mid: number; high: number }>();
  for (const e of (estimates ?? []) as Array<{
    fiscal_label: string; band_low_inr: number; band_mid_inr: number; band_high_inr: number;
  }>) {
    lastByQuarter.set(e.fiscal_label, {
      low: Number(e.band_low_inr),
      mid: Number(e.band_mid_inr),
      high: Number(e.band_high_inr),
    });
  }

  const scored: ScoredQuarter[] = [];
  for (const a of (actuals ?? []) as Array<{ fiscal_label: string; value_inr: number }>) {
    const estimate = lastByQuarter.get(a.fiscal_label);
    if (!estimate) continue;             // never estimated — not a miss, just absent
    const actual = Number(a.value_inr);
    scored.push({ fiscalLabel: a.fiscal_label, estimate, actual, ...scoreEstimate(estimate, actual) });
  }
  return summariseTrackRecord(scored);
}

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
  /** Owned channels whose value that day was spread from a multi-day catch-up. */
  imputed: number;
}

export async function getCompanyViewsSeries(opts: { from?: string; to?: string }): Promise<CompanyViewsRow[]> {
  const supabase = getServiceSupabase();
  const from = opts.from ?? new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('v_company_daily')
    .select('date, company, daily_views, imputed_channels')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  const rows = (data ?? []) as Array<{
    date: string; company: string; daily_views: number | null; imputed_channels: number | null;
  }>;
  const byDate = new Map<string, CompanyViewsRow>();
  for (const r of rows) {
    const slot = byDate.get(r.date) ?? { date: r.date, tipsmusic: null, saregama: null, imputed: 0 };
    slot.imputed += Number(r.imputed_channels ?? 0);
    if (r.company === 'TIPSMUSIC') slot.tipsmusic = r.daily_views != null ? Number(r.daily_views) : null;
    if (r.company === 'SAREGAMA') slot.saregama = r.daily_views != null ? Number(r.daily_views) : null;
    byDate.set(r.date, slot);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface TotalReachWeek {
  week: string; // Monday ISO date
  tips_low: number | null;
  tips_mid: number | null;
  tips_high: number | null;
  tips_owned: number | null;
  tips_topic: number | null;
  sare_low: number | null;
  sare_mid: number | null;
  sare_high: number | null;
  sare_owned: number | null;
  sare_topic: number | null;
}

export interface TotalReachResult {
  weeks: TotalReachWeek[];
  tips: { grade: RevenueEstimate['confidence_grade']; topic_coverage_start: string | null };
  saregama: { grade: RevenueEstimate['confidence_grade']; topic_coverage_start: string | null };
}

/**
 * Weekly "total reach" = owned + attributed-topic views, resampled to ISO weeks
 * and surfaced as a low/mid/high band. Owned views are exact, so the band width
 * comes entirely from the attributed topic layer (see buildReachBand). Owned has
 * years of history; topic only since tracking began (topic_coverage_start) — the
 * UI shades the pre-topic region so the topic step-up isn't read as a real jump.
 * UGC is shown SEPARATELY (getUGCReach) as a cumulative sampled figure, never
 * summed into this flow (different time base + completeness).
 */
export async function getCompanyTotalReachWeekly(opts: { weeks?: number }): Promise<TotalReachResult> {
  const weeks = opts.weeks ?? 12;
  const days = weeks * 7 + 7;
  const supabase = getServiceSupabase();
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // Owned weekly per company (daily flow from v_company_daily → ISO weeks).
  const { data: ownedRows } = await supabase
    .from('v_company_daily')
    .select('date, company, daily_views')
    .gte('date', from)
    .order('date', { ascending: true });
  const ownedByCompany: Record<'TIPSMUSIC' | 'SAREGAMA', DailyPoint[]> = {
    TIPSMUSIC: [],
    SAREGAMA: [],
  };
  for (const r of (ownedRows ?? []) as Array<{
    date: string;
    company: string;
    daily_views: number | null;
  }>) {
    if (r.company === 'TIPSMUSIC' || r.company === 'SAREGAMA') {
      ownedByCompany[r.company].push({
        date: r.date,
        value: r.daily_views != null ? Number(r.daily_views) : null,
      });
    }
  }

  // Topic weekly per company (attributed daily flow → ISO weeks).
  const [tipsTopic, sareTopic] = await Promise.all([
    getTopicReach({ company: 'TIPSMUSIC', days }),
    getTopicReach({ company: 'SAREGAMA', days }),
  ]);

  const ownedWeekly = (pts: DailyPoint[]) =>
    new Map(trimPartialEdges(bucketWeekly(pts)).map((w) => [w.weekStart, w.sum]));
  const topicWeekly = (snap: Awaited<ReturnType<typeof getTopicReach>>) => {
    const wk = bucketWeekly(
      snap.series.map((p) => ({ date: p.date, value: p.attributed_daily_views })),
    );
    return { map: new Map(wk.map((w) => [w.weekStart, w.sum])), start: wk.length ? wk[0].weekStart : null };
  };

  const tOwned = ownedWeekly(ownedByCompany.TIPSMUSIC);
  const sOwned = ownedWeekly(ownedByCompany.SAREGAMA);
  const tTopic = topicWeekly(tipsTopic);
  const sTopic = topicWeekly(sareTopic);

  const allWeeks = [...new Set([...tOwned.keys(), ...sOwned.keys()])].sort();
  const weeksOut: TotalReachWeek[] = allWeeks.map((week) => {
    const to = tOwned.get(week) ?? null;
    const so = sOwned.get(week) ?? null;
    const tt = tTopic.map.get(week) ?? 0;
    const st = sTopic.map.get(week) ?? 0;
    const tb = to != null ? buildReachBand({ owned: to, topic: tt }) : null;
    const sb = so != null ? buildReachBand({ owned: so, topic: st }) : null;
    return {
      week,
      tips_low: tb?.low ?? null,
      tips_mid: tb?.mid ?? null,
      tips_high: tb?.high ?? null,
      tips_owned: to,
      tips_topic: to != null ? tt : null,
      sare_low: sb?.low ?? null,
      sare_mid: sb?.mid ?? null,
      sare_high: sb?.high ?? null,
      sare_owned: so,
      sare_topic: so != null ? st : null,
    };
  });

  return {
    weeks: weeksOut,
    tips: { grade: tipsTopic.revenueEstimate.confidence_grade, topic_coverage_start: tTopic.start },
    saregama: { grade: sareTopic.revenueEstimate.confidence_grade, topic_coverage_start: sTopic.start },
  };
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
  top_ugc_channel: string | null;
}

export interface UGCSongAggRow {
  song: string;
  artist: string | null;
  ugc_count: number;
  ugc_views_sum: number;
  source_channel_name: string | null;
  catalog_matched: boolean;
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
  // I3: attribution breakdown across UGC where we've checked the music panel.
  // attribution_kind ∈ { 'content_id', 'sound_ref', 'none', 'unknown' }.
  // 'content_id' = label confirmed to be earning via Content ID claim.
  attributionCounts: Record<string, number>;
  // I4 (catalog-match): count of UGCs whose music-panel-extracted master
  // audio source resolves to one of our owned/topic channels. Subset of
  // attributionCounts.content_id — the strict-confirm path for "this UGC
  // is monetizing OUR catalog specifically."
  catalogMatchCount: number;
  // YT's NATIVE `licensedContent` flag from videos.list — set when ANY
  // partner has Content-ID-claimed the video. Broader than our music-panel
  // sample because it's populated on every enriched UGC, not just the
  // ATTRIBUTION_SAMPLE_SIZE per run.
  ytLicensedContentCount: number;
  totalEnriched: number;
  // Songs aggregated across the company's UGC snapshot, ordered by total
  // attributed view volume. Many anchors share the same song (the master
  // audio video for one song spawns many UGC clips across different pivots).
  topSongs: UGCSongAggRow[];
  topAnchors: UGCAnchorRow[];
  // Modelled UGC revenue band. Built from catalog-matched (strict-confirm)
  // attributed view volume × Shorts Creator Fund pool CPM × label pool
  // share. See lib/revenue-cpm.ts. Always low–high band.
  revenueEstimate: RevenueEstimate;
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

  // 6b) Enriched metadata for the discovered UGC ids (channel + attribution
  //     + source-channel resolution + licensedContent flag)
  const distinctUgcIds = Array.from(new Set(latestRows.map((r) => r.ugc_video_id)));
  const enrichedByUgc = new Map<
    string,
    {
      channel_id: string | null;
      latest_view_count: number | null;
      channel_name: string | null;
      attribution_kind: string | null;
      attribution_song: string | null;
      attribution_artist: string | null;
      attribution_source_channel_id: string | null;
      attribution_source_channel_name: string | null;
      licensed_content: boolean | null;
    }
  >();
  const attributionCounts: Record<string, number> = {};
  let ytLicensedContentCount = 0;
  let totalEnriched = 0;
  for (let i = 0; i < distinctUgcIds.length; i += 200) {
    const slice = distinctUgcIds.slice(i, i + 200);
    const { data: enriched } = await supabase
      .from('dim_ugc_video')
      .select(
        'ugc_video_id, channel_id, latest_view_count, channel_name, attribution_kind, attribution_song, attribution_artist, attribution_source_channel_id, attribution_source_channel_name, licensed_content',
      )
      .in('ugc_video_id', slice);
    for (const e of (enriched ?? []) as Array<{
      ugc_video_id: string;
      channel_id: string | null;
      latest_view_count: number | null;
      channel_name: string | null;
      attribution_kind: string | null;
      attribution_song: string | null;
      attribution_artist: string | null;
      attribution_source_channel_id: string | null;
      attribution_source_channel_name: string | null;
      licensed_content: boolean | null;
    }>) {
      enrichedByUgc.set(e.ugc_video_id, {
        channel_id: e.channel_id,
        latest_view_count: e.latest_view_count,
        channel_name: e.channel_name,
        attribution_kind: e.attribution_kind,
        attribution_song: e.attribution_song,
        attribution_artist: e.attribution_artist,
        attribution_source_channel_id: e.attribution_source_channel_id,
        attribution_source_channel_name: e.attribution_source_channel_name,
        licensed_content: e.licensed_content,
      });
      if (e.attribution_kind) {
        attributionCounts[e.attribution_kind] =
          (attributionCounts[e.attribution_kind] ?? 0) + 1;
      }
      totalEnriched += 1;
      if (e.licensed_content === true) ytLicensedContentCount += 1;
    }
  }

  // Headline reach: dedup by ugc_video_id, prefer exact videos.list counts over
  // the approximate accessibility-text parse, and exclude first-party Shorts
  // (posted by our own owned channels — those views are already in
  // v_company_daily, so summing them would double-count). chanIds = this
  // company's owned channels, resolved at step 1.
  const ugcMeta = new Map<string, UgcVideoMeta>();
  for (const [id, e] of enrichedByUgc) {
    ugcMeta.set(id, { channel_id: e.channel_id, latest_view_count: e.latest_view_count });
  }
  const reach = aggregateUgcReach(
    latestRows.map((r) => ({ ugc_video_id: r.ugc_video_id, view_count: r.view_count })),
    ugcMeta,
    new Set(chanIds),
  );

  // 6c) Catalog-match: how many UGCs have their attribution source resolved
  // to one of OUR (owned + topic) channels for this company. Topic channels
  // attribute via dim_artist_label, so for company=TIPSMUSIC we include any
  // owned channel of TIPSMUSIC + any topic channel where the linked artist
  // has a non-zero TIPSMUSIC catalog_share.
  const sourceChannelIds = Array.from(
    new Set(
      [...enrichedByUgc.values()]
        .map((e) => e.attribution_source_channel_id)
        .filter((id): id is string => id != null),
    ),
  );
  const ourChannelIds = new Set<string>();
  if (sourceChannelIds.length > 0) {
    // Owned channels of this company
    const { data: ownedChans } = await supabase
      .from('dim_channel')
      .select('channel_id')
      .eq('company', opts.company)
      .in('channel_id', sourceChannelIds);
    for (const c of (ownedChans ?? []) as Array<{ channel_id: string }>) {
      ourChannelIds.add(c.channel_id);
    }
    // Topic channels whose artist has a non-zero catalog_share for this company
    const { data: topicChans } = await supabase
      .from('dim_channel')
      .select('channel_id, artist_name')
      .eq('channel_type', 'topic')
      .in('channel_id', sourceChannelIds);
    const topicArtists = ((topicChans ?? []) as Array<{
      channel_id: string;
      artist_name: string;
    }>).filter((c) => c.artist_name);
    if (topicArtists.length > 0) {
      const { data: labels } = await supabase
        .from('dim_artist_label')
        .select('artist_name')
        .eq('company', opts.company)
        .in('artist_name', topicArtists.map((c) => c.artist_name));
      const labelArtistSet = new Set(
        ((labels ?? []) as Array<{ artist_name: string }>).map((l) => l.artist_name),
      );
      for (const c of topicArtists) {
        if (labelArtistSet.has(c.artist_name)) ourChannelIds.add(c.channel_id);
      }
    }
  }
  let catalogMatchCount = 0;
  for (const e of enrichedByUgc.values()) {
    if (
      e.attribution_source_channel_id != null &&
      ourChannelIds.has(e.attribution_source_channel_id)
    ) {
      catalogMatchCount += 1;
    }
  }

  // 6d) Songs aggregated across UGC for this snapshot. Same master-audio
  // video drives multiple UGC clips; grouping by song surfaces this
  // concentration cleanly. View sums use the per-snapshot view_count from
  // fct_ugc_short_match (parsed approx). Catalog-match flag follows the
  // source-channel resolution.
  type SongAgg = {
    song: string;
    artist: string | null;
    ugc_count: number;
    ugc_views_sum: number;
    source_channel_name: string | null;
    catalog_matched: boolean;
  };
  const songMap = new Map<string, SongAgg>();
  for (const r of latestRows) {
    const enr = enrichedByUgc.get(r.ugc_video_id);
    if (!enr || !enr.attribution_song) continue;
    const key = enr.attribution_song;
    const bucket = songMap.get(key) ?? {
      song: enr.attribution_song,
      artist: enr.attribution_artist,
      ugc_count: 0,
      ugc_views_sum: 0,
      source_channel_name: enr.attribution_source_channel_name,
      catalog_matched:
        enr.attribution_source_channel_id != null &&
        ourChannelIds.has(enr.attribution_source_channel_id),
    };
    bucket.ugc_count += 1;
    bucket.ugc_views_sum += r.view_count ?? 0;
    songMap.set(key, bucket);
  }
  const topSongs: UGCSongAggRow[] = [...songMap.values()]
    .sort((a, b) => b.ugc_views_sum - a.ugc_views_sum)
    .slice(0, 5);

  const topAnchors: UGCAnchorRow[] = [...byAnchor.entries()]
    .map(([source_video_id, a]) => ({
      source_video_id,
      source_title: titleByVid.get(source_video_id) ?? source_video_id,
      ugc_count: a.count,
      ugc_views_sum: a.views,
      top_ugc_id: a.topUgc,
      top_ugc_views: a.topViews,
      top_ugc_channel: enrichedByUgc.get(a.topUgc)?.channel_name ?? null,
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

  // Catalog-matched attributed UGC views drives the revenue estimate —
  // strict-confirm only (master audio in our owned/topic channels).
  // catalog_match attributedViews approximated as catalog_match
  // fraction × snapshot's total attributed views.
  const catalogMatchRatio = totalEnriched > 0 ? catalogMatchCount / totalEnriched : 0;
  const catalogAttributedViews = Math.round(reach.cumulative_views * catalogMatchRatio);
  const revenueEstimate = estimateUgcRevenue({
    attributed_views_7d: catalogAttributedViews,
    data_days: asofs.length,
    sample_size: totalEnriched,
    catalog_match_pct: catalogMatchRatio,
    backtest_calibration: null,
  });

  return {
    company: opts.company,
    latestAsof,
    priorAsof,
    snapshotsAvailable: asofs.length,
    ugc_shorts_count: reach.shorts_count,
    attributed_views: reach.cumulative_views,
    weekOverWeek,
    attributionCounts,
    catalogMatchCount,
    ytLicensedContentCount,
    totalEnriched,
    topSongs,
    topAnchors,
    revenueEstimate,
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
    attributionCounts: {},
    catalogMatchCount: 0,
    ytLicensedContentCount: 0,
    totalEnriched: 0,
    topSongs: [],
    topAnchors: [],
    revenueEstimate: estimateUgcRevenue({ attributed_views_7d: 0 }),
  };
}

// ---- UGC creator aggregation (Path C) ---------------------------------------

export interface UGCCreatorRow {
  channel_id: string;
  channel_name: string | null;
  ugc_count: number;             // how many UGC Shorts this creator has using our catalog
  ugc_views_sum: number;         // sum of attributed view counts
  distinct_songs: number;        // distinct catalog songs they've used
  distinct_sources: number;      // distinct master-audio source channels
  top_song: string | null;
  top_song_views: number;
}

/**
 * Top creators (by attributed UGC view volume) using a company's catalog.
 * Surfaces the influencer-tier accounts driving Content-ID-claimed UGC for
 * the label — useful for partnership/marketing analysis and for spotting
 * accounts that repeatedly source from our catalog.
 *
 * Restricted to UGC whose attribution_kind = 'content_id' (confirmed
 * Content ID match via the watch-page music panel).
 */
export async function getTopUGCCreators(opts: {
  company: Company;
  limit?: number;
}): Promise<UGCCreatorRow[]> {
  const supabase = getServiceSupabase();
  const limit = opts.limit ?? 10;

  // Pull all the company's UGC matches (latest asof) joined with attribution
  const { data: chans } = await supabase
    .from('dim_channel')
    .select('channel_id')
    .eq('company', opts.company)
    .eq('channel_type', 'owned');
  const chanIds = ((chans ?? []) as Array<{ channel_id: string }>).map((c) => c.channel_id);
  if (chanIds.length === 0) return [];

  const { data: vids } = await supabase
    .from('dim_video')
    .select('video_id')
    .in('channel_id', chanIds);
  const vidIds = ((vids ?? []) as Array<{ video_id: string }>).map((v) => v.video_id);
  if (vidIds.length === 0) return [];

  // Latest asof per anchor
  const { data: latestAsofRows } = await supabase
    .from('fct_ugc_short_match')
    .select('asof')
    .in('source_video_id', vidIds)
    .order('asof', { ascending: false })
    .limit(1);
  const latestAsof = ((latestAsofRows ?? []) as Array<{ asof: string }>)[0]?.asof;
  if (!latestAsof) return [];

  // Matches at that asof
  const { data: matches } = await supabase
    .from('fct_ugc_short_match')
    .select('ugc_video_id, view_count')
    .in('source_video_id', vidIds)
    .eq('asof', latestAsof);
  const matchRows = (matches ?? []) as Array<{
    ugc_video_id: string;
    view_count: number | null;
  }>;
  if (matchRows.length === 0) return [];

  const ugcIds = Array.from(new Set(matchRows.map((m) => m.ugc_video_id)));
  const viewByUgc = new Map<string, number>();
  for (const m of matchRows) {
    const cur = viewByUgc.get(m.ugc_video_id) ?? 0;
    viewByUgc.set(m.ugc_video_id, Math.max(cur, m.view_count ?? 0));
  }

  // Enriched: channel + attribution
  const enrichments: Array<{
    ugc_video_id: string;
    channel_id: string | null;
    channel_name: string | null;
    attribution_song: string | null;
    attribution_kind: string | null;
    attribution_source_channel_id: string | null;
  }> = [];
  for (let i = 0; i < ugcIds.length; i += 200) {
    const slice = ugcIds.slice(i, i + 200);
    const { data } = await supabase
      .from('dim_ugc_video')
      .select(
        'ugc_video_id, channel_id, channel_name, attribution_song, attribution_kind, attribution_source_channel_id',
      )
      .in('ugc_video_id', slice);
    enrichments.push(...((data ?? []) as typeof enrichments));
  }

  // Aggregate per-creator
  type CreatorAgg = {
    channel_id: string;
    channel_name: string | null;
    ugc_count: number;
    ugc_views_sum: number;
    songs: Set<string>;
    sources: Set<string>;
    topSong: string | null;
    topSongViews: number;
  };
  const byCreator = new Map<string, CreatorAgg>();
  for (const e of enrichments) {
    if (!e.channel_id) continue;
    // Only credit Content-ID-confirmed UGC to creator aggregation
    if (e.attribution_kind !== 'content_id') continue;
    const v = viewByUgc.get(e.ugc_video_id) ?? 0;
    const bucket = byCreator.get(e.channel_id) ?? {
      channel_id: e.channel_id,
      channel_name: e.channel_name,
      ugc_count: 0,
      ugc_views_sum: 0,
      songs: new Set<string>(),
      sources: new Set<string>(),
      topSong: null,
      topSongViews: 0,
    };
    bucket.ugc_count += 1;
    bucket.ugc_views_sum += v;
    if (e.attribution_song) bucket.songs.add(e.attribution_song);
    if (e.attribution_source_channel_id) bucket.sources.add(e.attribution_source_channel_id);
    if (e.attribution_song && v > bucket.topSongViews) {
      bucket.topSong = e.attribution_song;
      bucket.topSongViews = v;
    }
    byCreator.set(e.channel_id, bucket);
  }

  return [...byCreator.values()]
    .sort((a, b) => b.ugc_views_sum - a.ugc_views_sum)
    .slice(0, limit)
    .map((a) => ({
      channel_id: a.channel_id,
      channel_name: a.channel_name,
      ugc_count: a.ugc_count,
      ugc_views_sum: a.ugc_views_sum,
      distinct_songs: a.songs.size,
      distinct_sources: a.sources.size,
      top_song: a.topSong,
      top_song_views: a.topSongViews,
    }));
}

// ---- Candidate source channels (Path J) -------------------------------------

export interface CandidateSourceChannel {
  channel_id: string;
  channel_name: string | null;
  ugc_pointing_here: number;
  master_audio_views: number;
  observed_artists: string[];
  observed_songs: string[];
}

/**
 * Source-audio channels that appear as the master for at least N UGCs but
 * aren't in our dim_channel set — candidates to add as Topic channels.
 *
 * Today's run surfaced GowraHari (TIPS Telugu) and Jyotica Tangri (TIPS
 * Punjabi) this way. As the cron accumulates more UGC over the weeks,
 * additional artists will surface. This function powers an /ops surface
 * that proactively suggests Topic-channel additions.
 */
export async function getCandidateSourceChannels(opts: {
  minUgcCount?: number;
  limit?: number;
}): Promise<CandidateSourceChannel[]> {
  const supabase = getServiceSupabase();
  const minUgcCount = opts.minUgcCount ?? 2;
  const limit = opts.limit ?? 20;

  // Pull all UGC with resolved source channels (potentially huge)
  const { data: all } = await supabase
    .from('dim_ugc_video')
    .select(
      'attribution_source_channel_id, attribution_source_channel_name, attribution_song, attribution_artist',
    )
    .not('attribution_source_channel_id', 'is', null);
  const rows = (all ?? []) as Array<{
    attribution_source_channel_id: string;
    attribution_source_channel_name: string | null;
    attribution_song: string | null;
    attribution_artist: string | null;
  }>;
  if (rows.length === 0) return [];

  // Distinct source channel ids
  const sourceIds = Array.from(new Set(rows.map((r) => r.attribution_source_channel_id)));

  // Which of these ARE already in dim_channel?
  const trackedIds = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const slice = sourceIds.slice(i, i + 200);
    const { data: existing } = await supabase
      .from('dim_channel')
      .select('channel_id')
      .in('channel_id', slice);
    for (const c of (existing ?? []) as Array<{ channel_id: string }>) {
      trackedIds.add(c.channel_id);
    }
  }

  // Aggregate untracked
  type AggCandidate = {
    channel_id: string;
    channel_name: string | null;
    ugc_pointing_here: number;
    artists: Set<string>;
    songs: Set<string>;
  };
  const aggMap = new Map<string, AggCandidate>();
  for (const r of rows) {
    if (trackedIds.has(r.attribution_source_channel_id)) continue;
    const bucket = aggMap.get(r.attribution_source_channel_id) ?? {
      channel_id: r.attribution_source_channel_id,
      channel_name: r.attribution_source_channel_name,
      ugc_pointing_here: 0,
      artists: new Set<string>(),
      songs: new Set<string>(),
    };
    bucket.ugc_pointing_here += 1;
    if (r.attribution_artist) bucket.artists.add(r.attribution_artist);
    if (r.attribution_song) bucket.songs.add(r.attribution_song);
    aggMap.set(r.attribution_source_channel_id, bucket);
  }

  // For each candidate, fetch the master-audio-view count from fct_channel_daily
  // (latest row per channel). Skipped if no daily data exists yet — the
  // candidate hasn't been ingested by our channels cron.
  const candidates = [...aggMap.values()].filter((c) => c.ugc_pointing_here >= minUgcCount);
  return candidates
    .sort((a, b) => b.ugc_pointing_here - a.ugc_pointing_here)
    .slice(0, limit)
    .map((c) => ({
      channel_id: c.channel_id,
      channel_name: c.channel_name,
      ugc_pointing_here: c.ugc_pointing_here,
      master_audio_views: 0,
      observed_artists: [...c.artists],
      observed_songs: [...c.songs],
    }));
}

// ---- Topic-channel catalog reach --------------------------------------------

export interface TopicContributorRow {
  channel_id: string;
  channel_name: string;
  artist_name: string;
  kind: 'topic_auto' | 'oac';
  catalog_share: number;
  last_7d_raw_views: number;      // sum of daily_views over 7d
  last_7d_attributed_views: number; // raw × catalog_share
  latest_subscribers: number | null;
}

export interface TopicReachSnapshot {
  company: Company;
  channelsTracked: number;
  daysAvailable: number;
  // Daily series of attributed views (raw × catalog_share, summed across all
  // Topic+OAC channels of artists in this company). Sorted ascending by date.
  series: Array<{
    date: string;
    attributed_daily_views: number;
    /**
     * Channels that actually CONTRIBUTED a value on this date — not how many
     * rows exist. A frozen channel keeps its row with daily_views NULL, so a
     * day can carry a real-looking total built from only part of the roster.
     * Without this a partial day is indistinguishable from a complete one and
     * reads as a genuine dip. Compare against the largest count in the window.
     */
    channels_reporting: number;
    /**
     * Channel-days of exposure this date's value represents: the sum of
     * `delta_span_days` over the contributing channels. Usually equal to
     * `channels_reporting`, but larger where 0026 left a catch-up whole on an
     * unfreeze day. Without it the nowcast scales such a day UP for a freeze
     * whose views that very value already carries.
     */
    channel_days_covered: number;
  }>;
  // Rolling sums for headline figures
  totals: {
    last_1d: number;
    last_7d: number;
    last_30d: number;
  };
  // Last-7d vs prior-7d delta on attributed views
  weekOverWeek: {
    delta_views: number;
    pct: number;
  } | null;
  topContributors: TopicContributorRow[];
  // Modelled revenue band — IR-relevant rupee ranges derived from the
  // attributed view totals via lib/revenue-cpm.ts. Always low-high band,
  // never a point estimate.
  revenueEstimate: RevenueEstimate;
}

/**
 * Catalog reach via Topic + OAC channels.
 *
 * The IR interpretation: the label's catalog drives a second revenue leg on
 * YouTube — auto-generated audio Topic channels and Official Artist
 * Channels (OACs). Each artist's catalog is split across multiple labels;
 * dim_artist_label.catalog_share weights that split. This function returns
 * the daily attributed-view series (per-channel raw views × catalog_share,
 * summed) plus rolling windows and top contributors.
 *
 * Returns empty snapshot if no Topic/OAC channels are tracked for the
 * company OR if no fct_channel_daily data exists yet for them.
 */
export async function getTopicReach(opts: {
  company: Company;
  days?: number;
}): Promise<TopicReachSnapshot> {
  const supabase = getServiceSupabase();
  const days = opts.days ?? 60;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // 1) All artists with a non-zero catalog_share for this company
  const { data: labels } = await supabase
    .from('dim_artist_label')
    .select('artist_name, catalog_share')
    .eq('company', opts.company)
    .gt('catalog_share', 0);
  const shareByArtist = new Map<string, number>();
  for (const r of (labels ?? []) as Array<{ artist_name: string; catalog_share: number }>) {
    shareByArtist.set(r.artist_name, Number(r.catalog_share));
  }
  if (shareByArtist.size === 0) return emptyTopicSnapshot(opts.company);

  // 2) Topic + OAC channels for those artists
  const { data: chans } = await supabase
    .from('dim_channel')
    .select('channel_id, channel_name, artist_name, language, meta')
    .eq('channel_type', 'topic')
    .eq('is_active', true)
    .in('artist_name', [...shareByArtist.keys()]);
  const channels = ((chans ?? []) as Array<{
    channel_id: string;
    channel_name: string;
    artist_name: string;
    language: string | null;
    meta: { kind?: string; language?: string } | null;
  }>).map((c) => ({
    ...c,
    catalog_share: shareByArtist.get(c.artist_name) ?? 0,
    kind: (c.meta?.kind === 'oac' ? 'oac' : 'topic_auto') as 'topic_auto' | 'oac',
    // Resolve language: prefer dim_channel.language; fall back to meta.language
    resolved_language: (c.language ?? c.meta?.language ?? null) as string | null,
  }));
  if (channels.length === 0) return emptyTopicSnapshot(opts.company);

  const shareByChannel = new Map<string, number>(
    channels.map((c) => [c.channel_id, c.catalog_share]),
  );

  // 3) Daily facts over the window
  const channelIds = channels.map((c) => c.channel_id);
  const { data: facts } = await supabase
    .from('fct_channel_daily')
    // delta_span_days: a 0026 catch-up row holds several days of views, so the
    // day it lands on must not be scaled up again for the freeze it resolves.
    .select('channel_id, date, daily_views, subscribers, delta_span_days')
    .in('channel_id', channelIds)
    .gte('date', since)
    .order('date', { ascending: true });
  const factRows = (facts ?? []) as Array<{
    channel_id: string;
    date: string;
    daily_views: number | null;
    subscribers: number | null;
    delta_span_days: number | null;
  }>;

  // 4) Aggregate attributed views per date, carrying how many channels
  //    actually contributed — a day built from half the roster is not the same
  //    measurement as a day built from all of it.
  const dayAggregate = new Map<string, number>();
  const dayChannels = new Map<string, Set<string>>();
  const daySpan = new Map<string, number>();
  for (const r of factRows) {
    if (r.daily_views == null) continue;
    const share = shareByChannel.get(r.channel_id) ?? 0;
    if (share <= 0) continue;
    const attributed = Number(r.daily_views) * share;
    dayAggregate.set(r.date, (dayAggregate.get(r.date) ?? 0) + attributed);
    const contributors = dayChannels.get(r.date) ?? new Set<string>();
    contributors.add(r.channel_id);
    dayChannels.set(r.date, contributors);
    const span =
      r.delta_span_days != null && Number.isFinite(Number(r.delta_span_days)) &&
      Number(r.delta_span_days) >= 1
        ? Math.floor(Number(r.delta_span_days))
        : 1;
    daySpan.set(r.date, (daySpan.get(r.date) ?? 0) + span);
  }
  const series = [...dayAggregate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, attributed_daily_views]) => ({
      date,
      attributed_daily_views: Math.round(attributed_daily_views),
      channels_reporting: dayChannels.get(date)?.size ?? 0,
      channel_days_covered: daySpan.get(date) ?? dayChannels.get(date)?.size ?? 0,
    }));

  // 5) Rolling totals
  const sumLastN = (n: number): number =>
    series.slice(-n).reduce((acc, p) => acc + p.attributed_daily_views, 0);
  const totals = {
    last_1d: series[series.length - 1]?.attributed_daily_views ?? 0,
    last_7d: sumLastN(7),
    last_30d: sumLastN(30),
  };

  // 6) WoW = last-7d vs prior-7d
  let weekOverWeek: TopicReachSnapshot['weekOverWeek'] = null;
  if (series.length >= 14) {
    const lastWeek = series.slice(-7).reduce((acc, p) => acc + p.attributed_daily_views, 0);
    const priorWeek = series.slice(-14, -7).reduce((acc, p) => acc + p.attributed_daily_views, 0);
    const delta = lastWeek - priorWeek;
    weekOverWeek = {
      delta_views: delta,
      pct: priorWeek > 0 ? delta / priorWeek : 0,
    };
  }

  // 7) Top contributors: per-channel 7d sum × catalog_share, plus latest subs
  const channelAgg = new Map<
    string,
    { raw_7d: number; latest_subs: number | null; latest_date: string }
  >();
  const sevenDaysAgoMs = Date.now() - 7 * 86_400_000;
  for (const r of factRows) {
    const dMs = new Date(r.date + 'T00:00:00Z').getTime();
    const bucket = channelAgg.get(r.channel_id) ?? {
      raw_7d: 0,
      latest_subs: null,
      latest_date: '',
    };
    if (dMs >= sevenDaysAgoMs && r.daily_views != null) {
      bucket.raw_7d += Number(r.daily_views);
    }
    if (r.date > bucket.latest_date) {
      bucket.latest_date = r.date;
      bucket.latest_subs = r.subscribers ?? null;
    }
    channelAgg.set(r.channel_id, bucket);
  }
  const topContributors: TopicContributorRow[] = channels
    .map((c) => {
      const a = channelAgg.get(c.channel_id);
      const raw_7d = a?.raw_7d ?? 0;
      return {
        channel_id: c.channel_id,
        channel_name: c.channel_name,
        artist_name: c.artist_name,
        kind: c.kind,
        catalog_share: c.catalog_share,
        last_7d_raw_views: raw_7d,
        last_7d_attributed_views: Math.round(raw_7d * c.catalog_share),
        latest_subscribers: a?.latest_subs ?? null,
      };
    })
    .sort((a, b) => b.last_7d_attributed_views - a.last_7d_attributed_views)
    .slice(0, 6);

  // Per-channel language weights for CPM blending. Weight by 7d
  // attributed views so a high-traffic Hindi channel dominates a small
  // Punjabi channel's CPM influence.
  const languageMix = channels.map((c) => ({
    language: c.resolved_language,
    weight:
      (channelAgg.get(c.channel_id)?.raw_7d ?? 0) * c.catalog_share,
  }));
  const revenueEstimate = estimateTopicRevenue({
    attributed_1d_views: totals.last_1d,
    attributed_7d_views: totals.last_7d,
    languageMix,
    data_days: series.length,
    sample_size: channels.length,
    // Topic reach is by construction catalog-matched (every Topic channel
    // is tied to an artist in dim_artist_label), so 100% catalog-match.
    catalog_match_pct: 1.0,
    backtest_calibration: null, // populated when backtesting.ts engages
  });

  return {
    company: opts.company,
    channelsTracked: channels.length,
    daysAvailable: series.length,
    series,
    totals,
    weekOverWeek,
    topContributors,
    revenueEstimate,
  };
}

// ---- Broker consensus -------------------------------------------------------

export interface BrokerEstimateRow {
  broker_name: string;
  broker_type: 'institutional' | 'retail';
  asof: string;
  rating: string;
  target_price_inr: number | null;
  methodology: string | null;
  revenue_cagr_pct: number | null;
  notes: string | null;
  source_url: string | null;
}

export interface BrokerConsensusSnapshot {
  company: Company;
  latest_estimates: BrokerEstimateRow[]; // one per broker, most recent
  history: BrokerEstimateRow[];          // chronological, all estimates
  // Aggregate stats over the latest-per-broker set
  consensus: {
    n_brokers: number;
    n_buy: number;       // BUY / ADD / ACCUMULATE
    n_hold: number;      // HOLD / NEUTRAL
    n_sell: number;      // REDUCE / SELL
    target_low: number | null;
    target_median: number | null;
    target_high: number | null;
  };
}

/**
 * Sell-side broker consensus per company. Latest_estimates = the most
 * recent rating from each broker (one row per broker). History = all
 * estimates ever, chronological.
 *
 * Used to compare our YT-modelled revenue thesis against the published
 * sell-side view. Notably: as of the May 2026 research sweep, NO Indian
 * broker explicitly models YouTube as a discrete revenue line — so our
 * cockpit is net-additive to anything Tusk clients see elsewhere.
 */
export async function getBrokerConsensus(opts: {
  company: Company;
}): Promise<BrokerConsensusSnapshot> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('fct_broker_estimate')
    .select(
      'broker_name, asof, rating, target_price_inr, methodology, revenue_cagr_pct, notes, source_url, dim_broker!inner(broker_type)',
    )
    .eq('company', opts.company)
    .order('asof', { ascending: false });

  // PostgREST returns embedded relations as arrays even for many-to-one.
  // Pluck the first element; broker_name is unique so there's always one.
  type RawRow = {
    broker_name: string;
    asof: string;
    rating: string;
    target_price_inr: number | null;
    methodology: string | null;
    revenue_cagr_pct: number | null;
    notes: string | null;
    source_url: string | null;
    dim_broker:
      | { broker_type: 'institutional' | 'retail' }
      | Array<{ broker_type: 'institutional' | 'retail' }>;
  };
  const history: BrokerEstimateRow[] = ((data ?? []) as unknown as RawRow[]).map((r) => {
    const brokerMeta = Array.isArray(r.dim_broker) ? r.dim_broker[0] : r.dim_broker;
    return {
      broker_name: r.broker_name,
      broker_type: brokerMeta?.broker_type ?? 'institutional',
      asof: r.asof,
      rating: r.rating,
      target_price_inr: r.target_price_inr,
      methodology: r.methodology,
      revenue_cagr_pct: r.revenue_cagr_pct,
      notes: r.notes,
      source_url: r.source_url,
    };
  });

  // Latest per broker
  const latestByBroker = new Map<string, BrokerEstimateRow>();
  for (const r of history) {
    if (!latestByBroker.has(r.broker_name)) latestByBroker.set(r.broker_name, r);
  }
  const latest_estimates = [...latestByBroker.values()].sort((a, b) =>
    a.broker_name.localeCompare(b.broker_name),
  );

  // Aggregate stats
  const tps = latest_estimates
    .map((e) => e.target_price_inr)
    .filter((p): p is number => p != null && p > 0)
    .sort((a, b) => a - b);
  const target_median = tps.length ? tps[Math.floor(tps.length / 2)] : null;
  const buyRatings = new Set(['BUY', 'ADD', 'ACCUMULATE']);
  const holdRatings = new Set(['HOLD', 'NEUTRAL']);
  const sellRatings = new Set(['REDUCE', 'SELL']);
  const counts = latest_estimates.reduce(
    (acc, e) => {
      if (buyRatings.has(e.rating)) acc.n_buy += 1;
      else if (holdRatings.has(e.rating)) acc.n_hold += 1;
      else if (sellRatings.has(e.rating)) acc.n_sell += 1;
      return acc;
    },
    { n_buy: 0, n_hold: 0, n_sell: 0 },
  );

  return {
    company: opts.company,
    latest_estimates,
    history,
    consensus: {
      n_brokers: latest_estimates.length,
      ...counts,
      target_low: tps[0] ?? null,
      target_median,
      target_high: tps[tps.length - 1] ?? null,
    },
  };
}

function emptyTopicSnapshot(company: Company): TopicReachSnapshot {
  return {
    company,
    channelsTracked: 0,
    daysAvailable: 0,
    series: [],
    totals: { last_1d: 0, last_7d: 0, last_30d: 0 },
    weekOverWeek: null,
    topContributors: [],
    revenueEstimate: estimateTopicRevenue({ attributed_1d_views: 0, attributed_7d_views: 0 }),
  };
}

// ---- Consolidated YT revenue (Owned + Topic + UGC) --------------------------

export interface ConsolidatedYTRevenue {
  company: Company;
  // Per-layer revenue estimates with their own confidence
  owned: RevenueEstimate;
  topic: RevenueEstimate;
  ugc: RevenueEstimate;
  // Summed across all three layers
  total: { daily: RevenueCpmBand; weekly: RevenueCpmBand; quarterly: RevenueCpmBand };
  // Worst grade across the three constituents (the total is only as reliable
  // as its weakest input)
  worst_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  // Share of total weekly mid-band attributable to each layer
  composition: { owned_pct_mid: number; topic_pct_mid: number; ugc_pct_mid: number };
  // Underlying view aggregates for transparency
  owned_views_7d: number;
  owned_channels_count: number;
}

/**
 * Headline YT revenue band per company — sums Owned + Topic/OAC + UGC.
 * Each layer carries its own confidence grade; the consolidated grade
 * takes the worst.
 *
 * This is the IR-level summary view: a single rupee band the analyst can
 * compare directly against the broker's projected music-licensing
 * segment (× industry YT-share assumption).
 */
export async function getConsolidatedYTRevenue(opts: {
  company: Company;
}): Promise<ConsolidatedYTRevenue> {
  const supabase = getServiceSupabase();
  const today = new Date();
  const since60 = new Date(today.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);

  // --- Layer 1: Owned channels ---------------------------------------------
  // Sum daily_views from v_company_daily — view already filters to owned +
  // non-NULL company per migration 0011.
  const { data: companyDailyRows } = await supabase
    .from('v_company_daily')
    .select('date, daily_views')
    .eq('company', opts.company)
    .gte('date', since60)
    .order('date', { ascending: true });
  const ownedSeries = (companyDailyRows ?? []) as Array<{
    date: string;
    daily_views: number | null;
  }>;
  const ownedViews1d = ownedSeries[ownedSeries.length - 1]?.daily_views ?? 0;
  const ownedViews7d = ownedSeries
    .slice(-7)
    .reduce((acc, r) => acc + (r.daily_views ?? 0), 0);

  // Per-channel language mix for the company's owned channels
  const { data: ownedChans } = await supabase
    .from('dim_channel')
    .select('channel_id, language, meta')
    .eq('company', opts.company)
    .eq('channel_type', 'owned')
    .eq('is_active', true);
  const ownedChannelsCount = (ownedChans ?? []).length;
  // Approximate language mix by treating each channel as equally weighted.
  // (A more accurate weight would use trailing-7d views per channel —
  // future enhancement.)
  const ownedLanguageMix = ((ownedChans ?? []) as Array<{
    language: string | null;
    meta: { language?: string } | null;
  }>).map((c) => ({
    language: c.language ?? c.meta?.language ?? null,
    weight: 1,
  }));

  const ownedEstimate = estimateOwnedRevenue({
    views_1d: Number(ownedViews1d),
    views_7d: Number(ownedViews7d),
    languageMix: ownedLanguageMix,
    data_days: ownedSeries.length,
    sample_size: ownedChannelsCount,
    backtest_calibration: null,
  });

  // --- Layer 2 + Layer 3 — reuse existing snapshot fns --------------------
  const [topicSnap, ugcSnap] = await Promise.all([
    getTopicReach({ company: opts.company, days: 60 }),
    getUGCReach({ company: opts.company }),
  ]);

  const consolidated = estimateConsolidatedYT({
    owned: ownedEstimate,
    topic: topicSnap.revenueEstimate,
    ugc: ugcSnap.revenueEstimate,
  });

  return {
    company: opts.company,
    owned: ownedEstimate,
    topic: topicSnap.revenueEstimate,
    ugc: ugcSnap.revenueEstimate,
    total: consolidated.total,
    worst_grade: consolidated.worst_grade,
    composition: consolidated.composition,
    owned_views_7d: Number(ownedViews7d),
    owned_channels_count: ownedChannelsCount,
  };
}

// ---- C1/C2: India audio-DSP streaming-royalty leg ---------------------------

/**
 * Assumed label share of the national audio-DSP royalty pool. THIS IS A
 * PLACEHOLDER — there is no public per-catalog DSP stream data. Replace with a
 * disclosed/derived figure once available (e.g. label music-licensing revenue
 * ÷ IFPI India recorded-music revenue). The streaming-royalty estimate is
 * graded no better than 'D' precisely because of this assumption.
 */
const ASSUMED_CATALOG_SHARE: Record<Company, number> = {
  TIPSMUSIC: 0.03,
  SAREGAMA: 0.05,
};

export type { RoyaltyCrossCheck };

export interface StreamingRoyaltyEstimate {
  company: Company;
  assumed_catalog_share: number;
  inputs: {
    subscription_revenue_inr: number | null;
    ad_streams: number | null;
    recorded_music_revenue_inr: number | null;
    asof: string | null;
    source: string | null;
  };
  estimate: RevenueEstimate;
  /**
   * Reconciliation of the estimate against the recorded-music pool in the SAME
   * source table. See computeRoyaltyCrossCheck for why this exists.
   */
  cross_check: RoyaltyCrossCheck;
}

export async function getStreamingRoyalty(opts: {
  company: Company;
}): Promise<StreamingRoyaltyEstimate> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('fct_dsp_market')
    .select('asof, metric, value, source, confidence')
    .eq('scope', 'india')
    .in('metric', [
      'subscription_revenue_inr',
      'total_streams',
      'paid_streams',
      'recorded_music_revenue_inr',
    ])
    .order('asof', { ascending: false });

  const latest = new Map<string, { value: number; asof: string; source: string }>();
  for (const r of (data ?? []) as Array<{
    asof: string;
    metric: string;
    value: number;
    source: string;
    confidence: string;
  }>) {
    if (r.confidence === 'forecast') continue; // actuals only for the run-rate
    if (!latest.has(r.metric)) {
      latest.set(r.metric, { value: Number(r.value), asof: r.asof, source: r.source });
    }
  }

  const subRev = latest.get('subscription_revenue_inr')?.value ?? null;
  const totalStreams = latest.get('total_streams')?.value ?? null;
  const paidStreams = latest.get('paid_streams')?.value ?? null;
  const adStreams =
    totalStreams != null && paidStreams != null ? Math.max(0, totalStreams - paidStreams) : null;
  const share = ASSUMED_CATALOG_SHARE[opts.company];
  const asof = latest.get('subscription_revenue_inr')?.asof ?? null;
  const source = latest.get('subscription_revenue_inr')?.source ?? null;

  const estimate = estimateStreamingRoyalty({
    india_subscription_revenue_inr_annual: subRev ?? 0,
    india_ad_streams_annual: adStreams ?? 0,
    label_catalog_share: share,
    data_days: subRev != null ? 30 : 0,
    sample_size: subRev != null ? 1 : 0,
    notes: [
      asof ? `India market data as of ${asof} (${source})` : 'No India market data seeded',
    ],
  });

  // Reconcile against the recorded-music pool from the same table before this
  // number reaches a screen. Prefer the widest (EY-FICCI) definition when
  // several sources report it — a narrower pool would fail the check for the
  // wrong reason.
  const market = (data ?? [])
    .filter(
      (r: { metric: string; confidence: string }) =>
        r.metric === 'recorded_music_revenue_inr' && r.confidence !== 'forecast',
    )
    .reduce<number | null>(
      (acc, r: { value: number }) => (acc == null || Number(r.value) > acc ? Number(r.value) : acc),
      null,
    );

  const cross_check = computeRoyaltyCrossCheck({
    annual_mid_inr: estimate.quarterly.mid_inr * 4,
    assumed_catalog_share: share,
    recorded_music_revenue_inr: market,
    ad_streams: adStreams,
  });

  return {
    company: opts.company,
    assumed_catalog_share: share,
    inputs: {
      subscription_revenue_inr: subRev,
      ad_streams: adStreams,
      recorded_music_revenue_inr: market,
      asof,
      source,
    },
    estimate,
    cross_check,
  };
}

// ---- C2: India demand / paid-migration layer (sector-wide context) ----------

/**
 * How much app-proxy history getDemandLayer pulls. Must comfortably exceed
 * signals.WARMUP_DAYS (30) so demandMomentum can build several non-overlapping
 * weekly increments before it reports a direction.
 */
const APP_PROXY_WINDOW_DAYS = 180;

export interface DspMarketMetric {
  metric: string;
  value: number;
  unit: string;
  asof: string;
  source: string;
  source_url: string | null;
  confidence: string;
  notes: string | null;
}

export interface DspStatusRow {
  dsp: string;
  display_name: string;
  owner: string | null;
  status: string;
  status_asof: string | null;
  notes: string | null;
}

export interface AppProxyRow {
  dsp: string;
  store: string;
  source: string;
  date: string;
  rating_count: number | null;
  rating_avg: number | null;
  install_bucket: string | null;
  rating_count_30d_delta: number | null; // gross velocity proxy (cumulative, never decrements)
  /** Real span of the delta above — >30 when a missed cron pushed the anchor back. */
  delta_span_days: number | null;
  /** Days of history behind this app (drives the "accumulating" empty state). */
  days_observed: number;
  /**
   * Weekly-increment momentum of the cumulative metric. SECTOR demand only, and
   * graded LOW — never bias-weighted into the per-company IR READ.
   */
  momentum: SignalCell;
}

export interface DemandLayerSnapshot {
  asof: string | null;
  dsps: DspStatusRow[];
  india_market: DspMarketMetric[]; // latest actual per metric
  forecasts: DspMarketMetric[];
  /** Every actual, per metric, oldest-first — drives the paid-migration trajectory. */
  market_history: Record<string, DspMarketMetric[]>;
  apps: AppProxyRow[];
  spotify_regional: {
    asof: string;
    mau_total: number | null;
    premium_total: number | null;
    premium_row_pct: number | null;
  } | null;
  catalog_chart: {
    date: string | null;
    total: number;
    matches: number;
    matched: Array<{
      rank: number;
      track_title: string | null;
      artist: string | null;
      matched_company: string | null;
    }>;
  };
}

/**
 * The graded sector-tailwind / paid-migration context layer. Sector-wide
 * (not per-company) — answers "is the pie growing and shifting to paid?" NOT
 * "what is TIPS's share?" (no public per-catalog DSP data exists). Every figure
 * is source-cited; app/chart signals are GROSS demand proxies, graded LOW, and
 * are NOT bias-weighted into the IR READ.
 */
export async function getDemandLayer(): Promise<DemandLayerSnapshot> {
  const supabase = getServiceSupabase();

  const [{ data: dspData }, { data: marketData }, { data: appData }, { data: spotifyData }, { data: chartData }] =
    await Promise.all([
      supabase
        .from('dim_dsp')
        .select('dsp, display_name, owner, status, status_asof, notes, display_order')
        .order('display_order', { ascending: true }),
      supabase
        .from('fct_dsp_market')
        .select('asof, scope, metric, value, unit, source, source_url, confidence, notes')
        .eq('scope', 'india')
        .order('asof', { ascending: false }),
      // 180d: demandMomentum needs >= WARMUP_DAYS (30) plus several weekly
      // increments before it stops warming. Ordered DESC with an explicit cap so
      // that if the row limit ever bites, it drops the OLDEST history (momentum
      // simply warms up again) rather than today's headline snapshot.
      // Worst case ~6 DSPs x 3 sources x 180d = 3,240 rows.
      supabase
        .from('fct_app_proxy_daily')
        .select('dsp, store, source, date, rating_count, rating_avg, install_bucket')
        .gte('date', new Date(Date.now() - APP_PROXY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10))
        .order('date', { ascending: false })
        .limit(4000),
      supabase
        .from('fct_spotify_regional')
        .select('asof, mau_total, premium_total, premium_row_pct')
        .order('asof', { ascending: false })
        .limit(1),
      supabase
        .from('fct_catalog_chart_presence')
        .select('date, rank, track_title, artist, is_catalog_match, matched_company')
        .eq('chart', 'apple_music_songs')
        .order('date', { ascending: false })
        .order('rank', { ascending: true })
        .limit(100),
    ]);

  const dsps = ((dspData ?? []) as DspStatusRow[]).map((d) => ({
    dsp: d.dsp,
    display_name: d.display_name,
    owner: d.owner,
    status: d.status,
    status_asof: d.status_asof,
    notes: d.notes,
  }));

  // Latest actual per metric, plus forecast rows kept separate.
  const marketRows = (marketData ?? []) as DspMarketMetric[];
  const latestActual = new Map<string, DspMarketMetric>();
  const forecasts: DspMarketMetric[] = [];
  const market_history: Record<string, DspMarketMetric[]> = {};
  // marketRows arrive newest-first.
  for (const r of marketRows) {
    if (r.confidence === 'forecast') {
      forecasts.push(r);
    } else {
      if (!latestActual.has(r.metric)) latestActual.set(r.metric, r);
      (market_history[r.metric] ??= []).unshift(r); // unshift → oldest-first
    }
  }
  const india_market = [...latestActual.values()];
  const asof = india_market.reduce<string | null>(
    (acc, m) => (acc == null || m.asof > acc ? m.asof : acc),
    null,
  );

  // App proxies: one row per (dsp, store, source) — latest snapshot, a true
  // 30-day rating velocity, and weekly-increment momentum over the full window.
  type RawApp = AppProxyPoint & { dsp: string; store: string; source: string };
  const byKey = new Map<string, RawApp[]>();
  for (const r of (appData ?? []) as RawApp[]) {
    const key = `${r.dsp}|${r.store}|${r.source}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const apps: AppProxyRow[] = [];
  for (const series of byKey.values()) {
    const rollup = rollupAppProxySeries(series, 30);
    if (!rollup) continue;
    const head = series[0]; // identity fields are constant across the group
    apps.push({
      dsp: head.dsp,
      store: head.store,
      source: head.source,
      date: rollup.latest.date,
      rating_count: rollup.latest.rating_count,
      rating_avg: rollup.latest.rating_avg,
      install_bucket: rollup.latest.install_bucket,
      rating_count_30d_delta: rollup.rating_count_delta,
      delta_span_days: rollup.delta_span_days,
      days_observed: rollup.days_observed,
      momentum: demandMomentum(rollup.history),
    });
  }
  apps.sort((a, b) => a.dsp.localeCompare(b.dsp) || a.store.localeCompare(b.store));

  const sRow = ((spotifyData ?? []) as Array<{
    asof: string;
    mau_total: number | null;
    premium_total: number | null;
    premium_row_pct: number | null;
  }>)[0];
  const spotify_regional = sRow
    ? {
        asof: sRow.asof,
        mau_total: sRow.mau_total,
        premium_total: sRow.premium_total,
        premium_row_pct: sRow.premium_row_pct,
      }
    : null;

  // Catalog chart presence — most recent date only.
  type RawChart = {
    date: string;
    rank: number;
    track_title: string | null;
    artist: string | null;
    is_catalog_match: boolean;
    matched_company: string | null;
  };
  const chartRows = (chartData ?? []) as RawChart[];
  const chartDate = chartRows[0]?.date ?? null;
  const todayRows = chartDate ? chartRows.filter((r) => r.date === chartDate) : [];
  const matched = todayRows
    .filter((r) => r.is_catalog_match)
    .map((r) => ({
      rank: r.rank,
      track_title: r.track_title,
      artist: r.artist,
      matched_company: r.matched_company,
    }));

  return {
    asof,
    dsps,
    india_market,
    forecasts,
    market_history,
    apps,
    spotify_regional,
    catalog_chart: {
      date: chartDate,
      total: todayRows.length,
      matches: matched.length,
      matched,
    },
  };
}

/**
 * Every figure read off a filing, confirmed or not.
 *
 * The nowcast is scored against these rows, so they are the evidence and belong
 * on screen rather than only inside getTrackRecord's closure. Unconfirmed rows
 * are returned DELIBERATELY — getNowcastHeadline filters them out of the
 * headline, and the only way a reader can tell a checked figure from an
 * unchecked one is to see both with the flag attached.
 */
export interface ReportedFinancialRow {
  company: Company;
  fiscal_label: string;
  line_item: string;
  /** RUPEES. Divide by 1e7 for crore (rupeesToCrore).*/
  value_inr: number;
  confirmed: boolean;
  source_url: string | null;
  notes: string | null;
}

export async function getReportedFinancials(): Promise<ReportedFinancialRow[]> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('fct_reported_financials')
    .select('company, fiscal_label, line_item, value_inr, source_url, confirmed_by, notes')
    .order('company', { ascending: true })
    .order('fiscal_label', { ascending: false });

  return ((data ?? []) as Array<{
    company: string;
    fiscal_label: string;
    line_item: string;
    value_inr: number | string;
    source_url: string | null;
    confirmed_by: string | null;
    notes: string | null;
  }>).map((r) => ({
    company: r.company as Company,
    fiscal_label: r.fiscal_label,
    line_item: r.line_item,
    value_inr: Number(r.value_inr),
    confirmed: r.confirmed_by != null,
    source_url: r.source_url,
    notes: r.notes,
  }));
}
