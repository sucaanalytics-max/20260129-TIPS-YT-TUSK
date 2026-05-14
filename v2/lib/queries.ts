import 'server-only';
import { getServiceSupabase } from '@/lib/supabase/server';

/**
 * Server-only data layer for the Tusk v2 dashboard.
 *
 * Tables are all under the public schema in the configured Supabase project:
 *   dim_channel, dim_video, fct_channel_daily, fct_video_daily, fct_price_daily.
 *
 * These functions are designed to be call-once-per-render and tolerate the
 * tables not existing yet (returns nulls / empty arrays). The frontend renders
 * placeholders in that state.
 */

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
        latest_date: data?.[0]?.date ?? null,
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
  ]);
}

export async function getOverview(): Promise<OverviewData> {
  const supabase = getServiceSupabase();

  // Latest price (TIPSMUSIC)
  const { data: priceRows } = await supabase
    .from('fct_price_daily')
    .select('date, close, daily_change, daily_change_pct')
    .eq('symbol', 'TIPSMUSIC')
    .order('date', { ascending: false })
    .limit(1);
  const latestPrice = priceRows?.[0];

  // Latest aggregate Tips channel-day
  const { data: channelRows } = await supabase
    .from('fct_channel_daily')
    .select('date, daily_views, daily_subscribers, total_views, subscribers')
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
      label: 'Daily new subscribers',
      value:
        latestChannel?.daily_subscribers != null
          ? Number(latestChannel.daily_subscribers).toLocaleString()
          : '—',
      hint: 'YouTube rounds subs > 1k',
    },
    {
      label: 'Total cumulative views',
      value:
        latestChannel?.total_views != null
          ? Number(latestChannel.total_views).toLocaleString()
          : '—',
    },
  ];

  return { asOf, kpis };
}
