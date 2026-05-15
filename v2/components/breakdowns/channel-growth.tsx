'use client';

import { useMemo, useState } from 'react';
import type { ChannelGrowthRow } from '@/lib/queries';
import { Sparkline } from '@/components/charts/sparkline';
import {
  MA_OPTIONS,
  MA_WINDOWS,
  rollingMeanArray,
  type MASmoothing,
} from '@/lib/smoothing';

type SortKey =
  | 'channel_name'
  | 'subscribers'
  | 'daily_views_yesterday'
  | 'avg_7d'
  | 'avg_30d'
  | 'avg_90d'
  | 'growth_7d_pct'
  | 'growth_30d_pct'
  | 'growth_90d_pct';

const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());
const pct = (n: number | null | undefined) => {
  if (n == null) return <span className="text-muted-foreground">—</span>;
  const positive = n >= 0;
  return (
    <span className={positive ? 'text-emerald-400' : 'text-red-400'}>
      {positive ? '+' : ''}
      {n.toFixed(2)}%
    </span>
  );
};

export function ChannelGrowth({ rows }: { rows: ChannelGrowthRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'avg_30d',
    dir: 'desc',
  });
  const [smoothing, setSmoothing] = useState<MASmoothing>('abs');

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sort.key] as number | string | null;
      const bv = b[sort.key] as number | string | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return out;
  }, [rows, sort]);

  const sparkValues = useMemo(() => {
    const w = MA_WINDOWS[smoothing];
    const out = new Map<string, Array<number | null>>();
    for (const r of rows) {
      out.set(r.channel_id, w <= 1 ? r.daily_series_60d : rollingMeanArray(r.daily_series_60d, w));
    }
    return out;
  }, [rows, smoothing]);

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'right') {
    const active = sort.key === key;
    const arrow = active ? (sort.dir === 'asc' ? '↑' : '↓') : '';
    return (
      <th
        onClick={() =>
          setSort((s) =>
            s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
          )
        }
        className={`text-muted-foreground hover:text-foreground cursor-pointer select-none px-4 py-3 text-xs uppercase tracking-wider ${
          align === 'right' ? 'text-right' : 'text-left'
        }`}
      >
        {label} {arrow}
      </th>
    );
  }

  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no channel growth data yet
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border">
      <header className="border-border flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-3">
        <p className="text-muted-foreground text-xs">
          {rows.length} channels · 60-day trend sparklines per row
        </p>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Sparkline:</span>
          {MA_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSmoothing(opt.value)}
              className={`rounded-md border px-2.5 py-1 transition-colors ${
                smoothing === opt.value
                  ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-border border-b">
            <tr>
              {header('channel_name', 'Channel', 'left')}
              <th className="text-muted-foreground px-4 py-3 text-left text-xs uppercase tracking-wider">Lang</th>
              {header('subscribers', 'Subs')}
              {header('daily_views_yesterday', 'Yesterday')}
              {header('avg_7d', '7d avg')}
              {header('growth_7d_pct', 'WoW %')}
              {header('avg_30d', '30d avg')}
              {header('growth_30d_pct', 'MoM %')}
              {header('avg_90d', '90d avg')}
              {header('growth_90d_pct', 'QoQ %')}
              <th className="text-muted-foreground px-4 py-3 text-left text-xs uppercase tracking-wider">Trend (60d)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.channel_id} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.channel_name}</td>
                <td className="text-muted-foreground px-4 py-2.5 text-xs">{r.language ?? '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(r.subscribers)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(r.daily_views_yesterday)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(r.avg_7d != null ? Math.round(r.avg_7d) : null)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.growth_7d_pct)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(r.avg_30d != null ? Math.round(r.avg_30d) : null)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.growth_30d_pct)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(r.avg_90d != null ? Math.round(r.avg_90d) : null)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.growth_90d_pct)}</td>
                <td className="px-4 py-2.5">
                  <Sparkline values={sparkValues.get(r.channel_id) ?? r.daily_series_60d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
