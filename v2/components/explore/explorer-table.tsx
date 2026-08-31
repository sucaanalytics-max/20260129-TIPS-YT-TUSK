'use client';

import { useMemo, useState } from 'react';
import type { ExplorerRow } from '@/lib/queries';
import { METRIC_LABEL, type ExplorerMetric } from '@/lib/metrics';
import { REGIME_BREAK } from '@/lib/period-compare';

type SortKey = 'date' | 'company' | ExplorerMetric | 'channels';
type Grain = 'day' | 'week' | 'month' | 'quarter';

const fmt = (n: number | null): string => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-IN');
};

const bucket = (date: string, g: Grain): string => {
  if (g === 'day') return date;
  if (g === 'month') return date.slice(0, 7);
  if (g === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  const d = new Date(date + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Monday-based
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

/**
 * The explorer grid: slice, aggregate and sort the daily series.
 *
 * The date range drives an honest constraint. Before REGIME_BREAK the company
 * series is a single synthetic aggregate row per day, so per-channel counts do
 * not exist; rather than returning an empty channel column and letting the
 * reader infer the catalogue went quiet, the table says so and the column
 * reads "n/a" for those rows.
 */
export function ExplorerTable({ rows }: { rows: ExplorerRow[] }) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<ExplorerMetric[]>(['views', 'subscribers', 'releases']);
  const [grain, setGrain] = useState<Grain>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [hideImputed, setHideImputed] = useState(false);

  const allCompanies = useMemo(() => [...new Set(rows.map((r) => r.company))].sort(), [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (companies.length) out = out.filter((r) => companies.includes(r.company));
    if (from) out = out.filter((r) => r.date >= from);
    if (to) out = out.filter((r) => r.date <= to);
    if (hideImputed) out = out.filter((r) => r.imputed === 0);
    return out;
  }, [rows, companies, from, to, hideImputed]);

  const aggregated = useMemo(() => {
    if (grain === 'day') return filtered;
    const acc = new Map<string, ExplorerRow>();
    for (const r of filtered) {
      const key = `${bucket(r.date, grain)}|${r.company}`;
      const cur = acc.get(key);
      if (!cur) {
        acc.set(key, { ...r, date: bucket(r.date, grain) });
      } else {
        cur.views = (cur.views ?? 0) + (r.views ?? 0);
        cur.subscribers = (cur.subscribers ?? 0) + (r.subscribers ?? 0);
        cur.releases = (cur.releases ?? 0) + (r.releases ?? 0);
        cur.channels = Math.max(cur.channels, r.channels);
        cur.imputed += r.imputed;
        cur.sliceable = cur.sliceable && r.sliceable;
      }
    }
    return [...acc.values()];
  }, [filtered, grain]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...aggregated].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [aggregated, sort]);

  const totals = useMemo(
    () =>
      sorted.reduce(
        (a, r) => ({
          views: a.views + (r.views ?? 0),
          subscribers: a.subscribers + (r.subscribers ?? 0),
          releases: a.releases + (r.releases ?? 0),
        }),
        { views: 0, subscribers: 0, releases: 0 },
      ),
    [sorted],
  );

  const preRegime = sorted.some((r) => !r.sliceable);
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const head = (key: SortKey, label: string, right = false) => (
    <th
      className={`text-muted-foreground cursor-pointer py-1.5 pr-3 font-medium select-none hover:text-foreground ${right ? 'text-right' : 'text-left'}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      {label}
      {sort.key === key ? <span className="ml-1 opacity-60">{sort.dir === 'desc' ? '↓' : '↑'}</span> : null}
    </th>
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      {/* slicers */}
      <div className="border-border/60 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Company</span>
          {allCompanies.map((c) => (
            <button
              key={c}
              onClick={() => toggle(companies, c, setCompanies)}
              className={`rounded-md border px-2 py-1 ${
                companies.includes(c) || companies.length === 0
                  ? 'border-info/60 bg-info/15 text-info'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Metric</span>
          {(['views', 'subscribers', 'releases'] as const).map((m) => (
            <button
              key={m}
              onClick={() => toggle(metrics, m, setMetrics)}
              className={`rounded-md border px-2 py-1 ${
                metrics.includes(m)
                  ? 'border-info/60 bg-info/15 text-info'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Grain</span>
          {(['day', 'week', 'month', 'quarter'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGrain(g)}
              className={`rounded-md border px-2 py-1 capitalize ${
                grain === g ? 'border-info/60 bg-info/15 text-info' : 'border-border text-muted-foreground'
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border-border bg-background rounded-md border px-2 py-1" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border-border bg-background rounded-md border px-2 py-1" />
        </div>

        <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 select-none">
          <input type="checkbox" checked={hideImputed} onChange={(e) => setHideImputed(e.target.checked)} className="accent-info" />
          Exclude repaired days
        </label>

        <span className="text-muted-foreground ml-auto tabular-nums">{sorted.length} rows</span>
      </div>

      {preRegime ? (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning">
          This range reaches before {REGIME_BREAK}, where the series is a single legacy
          aggregate row per day. Those rows have no per-channel breakdown, so the channel
          column reads n/a — they are not zero.
        </p>
      ) : null}

      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-border/60 bg-card sticky top-0 border-b">
            <tr>
              {head('date', grain === 'day' ? 'Date' : 'Period')}
              {head('company', 'Company')}
              {metrics.includes('views') ? head('views', 'Views', true) : null}
              {metrics.includes('subscribers') ? head('subscribers', 'Subs Δ', true) : null}
              {metrics.includes('releases') ? head('releases', 'Releases', true) : null}
              {head('channels', 'Channels', true)}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.date}|${r.company}`} className="border-border/30 border-b last:border-0">
                <td className="text-foreground py-1.5 pr-3 tabular-nums">{r.date}</td>
                <td className="text-muted-foreground py-1.5 pr-3">
                  {r.company}
                  {r.imputed > 0 ? (
                    <span className="ml-1.5 text-warning" title={`${r.imputed} channel-days repaired`}>·</span>
                  ) : null}
                </td>
                {metrics.includes('views') ? <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">{fmt(r.views)}</td> : null}
                {metrics.includes('subscribers') ? <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">{fmt(r.subscribers)}</td> : null}
                {metrics.includes('releases') ? <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">{fmt(r.releases)}</td> : null}
                <td className="text-muted-foreground py-1.5 text-right tabular-nums">
                  {r.sliceable ? r.channels : <span className="opacity-50">n/a</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-border/60 bg-card sticky bottom-0 border-t">
            <tr className="text-foreground font-medium">
              <td className="py-1.5 pr-3">Total</td>
              <td className="py-1.5 pr-3" />
              {metrics.includes('views') ? <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(totals.views)}</td> : null}
              {metrics.includes('subscribers') ? <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(totals.subscribers)}</td> : null}
              {metrics.includes('releases') ? <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(totals.releases)}</td> : null}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
