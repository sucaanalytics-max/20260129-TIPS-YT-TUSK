'use client';

import { useMemo, useState } from 'react';
import type { ExplorerRow } from '@/lib/queries';
import { METRIC_LABEL, type ExplorerMetric } from '@/lib/metrics';
import { REGIME_BREAK } from '@/lib/period-compare';

type SortKey = 'date' | 'company' | ExplorerMetric | 'channels';
type Grain = 'day' | 'week' | 'month' | 'quarter';
type Layout = 'rows' | 'peer';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Compact for reading; the exact figure rides along in the cell's title. */
const fmt = (n: number | null): string => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-IN');
};
const exact = (n: number | null): string => (n == null ? 'no reading' : n.toLocaleString('en-IN'));

const bucket = (date: string, g: Grain): string => {
  if (g === 'day') return date;
  if (g === 'month') return date.slice(0, 7);
  if (g === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  const d = new Date(date + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Monday-based
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

const PRESETS: Array<{ label: string; days: number | 'ytd' | 'all' }> = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'YTD', days: 'ytd' },
  { label: '1Y', days: 365 },
  { label: 'All', days: 'all' },
];

/**
 * The explorer grid: slice, aggregate, compare and export the daily series.
 *
 * Two constraints shape it. The date range hits an honest one: before
 * REGIME_BREAK the company series is a single synthetic aggregate row per day,
 * so per-channel counts do not exist. Rather than returning an empty channel
 * column and letting the reader infer the catalogue went quiet, the table says
 * so and the column reads "n/a" for those rows.
 *
 * The second is that the CSV exports exactly what is on screen — the same
 * filters, grain, sort and column set. An export that quietly differs from the
 * view it came from is how a number ends up in a deck with no way back to it.
 */
export function ExplorerTable({ rows }: { rows: ExplorerRow[] }) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<ExplorerMetric[]>(['views', 'subscribers', 'releases']);
  const [grain, setGrain] = useState<Grain>('day');
  const [layout, setLayout] = useState<Layout>('rows');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [hideImputed, setHideImputed] = useState(false);

  const allCompanies = useMemo(() => [...new Set(rows.map((r) => r.company))].sort(), [rows]);

  const applyPreset = (days: number | 'ytd' | 'all') => {
    if (days === 'all') {
      setFrom('');
      setTo('');
      return;
    }
    const now = Date.now();
    setTo(iso(now));
    setFrom(days === 'ytd' ? `${new Date(now).getUTCFullYear()}-01-01` : iso(now - days * DAY));
  };

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

  /** One row per period, companies pivoted into columns. */
  const peerRows = useMemo(() => {
    const byPeriod = new Map<string, Record<string, ExplorerRow>>();
    for (const r of aggregated) {
      const slot = byPeriod.get(r.date) ?? {};
      slot[r.company] = r;
      byPeriod.set(r.date, slot);
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...byPeriod.entries()]
      .sort((a, b) => (a[0] > b[0] ? 1 : -1) * dir)
      .map(([date, byCompany]) => ({ date, byCompany }));
  }, [aggregated, sort.dir]);

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

  /*
   * Built from `sorted`, so the download is the view. Blob rather than a data
   * URL: a year of daily rows across both companies overruns the URL length
   * limit in several browsers and would truncate silently.
   */
  const csv = useMemo(() => {
    const cols = ['date', 'company', ...metrics, 'channels', 'repaired_channel_days'];
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = sorted.map((r) =>
      [
        r.date,
        r.company,
        ...metrics.map((m) => r[m] ?? ''),
        r.sliceable ? r.channels : '',
        r.imputed,
      ]
        .map(esc)
        .join(','),
    );
    return [cols.join(','), ...body].join('\n');
  }, [sorted, metrics]);

  const download = () => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tusk-${grain}-${from || 'start'}-to-${to || 'latest'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const preRegime = sorted.some((r) => !r.sliceable);
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const chip = (on: boolean) =>
    `rounded-md border px-2 py-1 transition-colors ${
      on ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:text-ink2'
    }`;

  const head = (key: SortKey, label: string, right = false) => (
    <th
      className={`text-muted-foreground hover:text-ink cursor-pointer select-none py-1.5 pr-3 font-medium ${right ? 'text-right' : 'text-left'}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
    >
      {label}
      {sort.key === key ? <span className="ml-1 opacity-60">{sort.dir === 'desc' ? '↓' : '↑'}</span> : null}
    </th>
  );

  return (
    <div className="p-pad">
      {/* slicers */}
      <div className="border-border/60 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Company</span>
          {allCompanies.map((c) => (
            <button key={c} onClick={() => toggle(companies, c, setCompanies)} className={chip(companies.includes(c) || companies.length === 0)}>
              {c}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Metric</span>
          {(['views', 'subscribers', 'releases'] as const).map((m) => (
            <button key={m} onClick={() => toggle(metrics, m, setMetrics)} className={chip(metrics.includes(m))}>
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Grain</span>
          {(['day', 'week', 'month', 'quarter'] as const).map((g) => (
            <button key={g} onClick={() => setGrain(g)} className={`${chip(grain === g)} capitalize`}>
              {g}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Range</span>
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p.days)} className={chip(false)}>
              {p.label}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From"
            className="border-border bg-background text-ink2 rounded-md border px-2 py-1" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To"
            className="border-border bg-background text-ink2 rounded-md border px-2 py-1" />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Layout</span>
          <button onClick={() => setLayout('rows')} className={chip(layout === 'rows')}>Rows</button>
          <button onClick={() => setLayout('peer')} className={chip(layout === 'peer')}>Peer</button>
        </div>

        <label className="text-muted-foreground flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={hideImputed} onChange={(e) => setHideImputed(e.target.checked)} className="accent-info" />
          Exclude repaired days
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground tabular-nums">
            {layout === 'peer' ? `${peerRows.length} periods` : `${sorted.length} rows`}
          </span>
          <button
            onClick={download}
            disabled={sorted.length === 0}
            className="border-border text-ink2 hover:border-accent hover:text-accent rounded-md border px-2.5 py-1 transition-colors disabled:opacity-40"
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {preRegime ? (
        <p className="border-warn/30 bg-warn/5 text-warn mb-3 rounded-md border p-2 text-[11px]">
          This range reaches before {REGIME_BREAK}, where the series is a single legacy aggregate row
          per day. Those rows have no per-channel breakdown, so the channel column reads n/a — they
          are not zero.
        </p>
      ) : null}

      <div className="max-h-[520px] overflow-auto">
        {layout === 'rows' ? (
          <table className="w-full text-left text-xs">
            <thead className="border-border/60 bg-surface sticky top-0 border-b">
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
                <tr key={`${r.date}|${r.company}`} className="border-border/30 hover:bg-surface2/60 border-b last:border-0">
                  <td className="text-ink py-1.5 pr-3 tabular-nums">{r.date}</td>
                  <td className="text-muted-foreground py-1.5 pr-3">
                    {r.company}
                    {r.imputed > 0 ? (
                      <span className="text-warn ml-1.5" title={`${r.imputed} channel-days repaired`}>·</span>
                    ) : null}
                  </td>
                  {metrics.map((m) => (
                    <td key={m} className="text-ink py-1.5 pr-3 text-right tabular-nums" title={exact(r[m])}>
                      {fmt(r[m])}
                    </td>
                  ))}
                  <td className="text-muted-foreground py-1.5 text-right tabular-nums">
                    {r.sliceable ? r.channels : <span className="opacity-50">n/a</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-border/60 bg-surface sticky bottom-0 border-t">
              <tr className="text-ink font-medium">
                <td className="py-1.5 pr-3">Total</td>
                <td className="py-1.5 pr-3" />
                {metrics.map((m) => (
                  <td key={m} className="py-1.5 pr-3 text-right tabular-nums" title={exact(totals[m])}>
                    {fmt(totals[m])}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <PeerTable rows={peerRows} companies={allCompanies} metrics={metrics} grain={grain} />
        )}
      </div>
    </div>
  );
}

/**
 * Peer layout: one row per period, each metric shown for both companies with
 * the gap between them.
 *
 * The Δ column is a RATIO, not a difference: the two catalogues are different
 * sizes, so "Tips did 12M fewer views" says less than "Tips ran at 0.84× of
 * Saregama". Subtracting would make the larger company look like the story on
 * every single row.
 */
function PeerTable({
  rows,
  companies,
  metrics,
  grain,
}: {
  rows: Array<{ date: string; byCompany: Record<string, ExplorerRow> }>;
  companies: string[];
  metrics: ExplorerMetric[];
  grain: Grain;
}) {
  const [a, b] = companies;

  if (companies.length < 2) {
    return (
      <p className="text-muted-foreground p-4 text-xs">
        Peer layout needs two companies. Clear the company filter to compare them.
      </p>
    );
  }

  return (
    <table className="w-full text-left text-xs">
      <thead className="border-border/60 bg-surface sticky top-0 border-b">
        <tr>
          <th className="text-muted-foreground py-1.5 pr-3 font-medium">
            {grain === 'day' ? 'Date' : 'Period'}
          </th>
          {metrics.map((m) => (
            <th key={m} colSpan={3} className="text-muted-foreground border-border/40 border-l py-1.5 pl-3 pr-3 text-center font-medium">
              {METRIC_LABEL[m]}
            </th>
          ))}
        </tr>
        <tr className="text-muted-foreground text-[10px]">
          <th />
          {metrics.flatMap((m) => [
            <th key={`${m}-a`} className="border-border/40 border-l py-1 pl-3 pr-3 text-right font-normal">{a}</th>,
            <th key={`${m}-b`} className="py-1 pr-3 text-right font-normal">{b}</th>,
            <th key={`${m}-d`} className="py-1 pr-3 text-right font-normal">×</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date} className="border-border/30 hover:bg-surface2/60 border-b last:border-0">
            <td className="text-ink py-1.5 pr-3 tabular-nums">{row.date}</td>
            {metrics.flatMap((m) => {
              const av = row.byCompany[a]?.[m] ?? null;
              const bv = row.byCompany[b]?.[m] ?? null;
              // A ratio needs a positive denominator; zero releases in a week is
              // a real value but not a base you can divide by.
              const ratio = av != null && bv != null && bv > 0 ? av / bv : null;
              return [
                <td key={`${m}-a`} className="text-ink border-border/40 border-l py-1.5 pl-3 pr-3 text-right tabular-nums" title={exact(av)}>
                  {fmt(av)}
                </td>,
                <td key={`${m}-b`} className="text-ink py-1.5 pr-3 text-right tabular-nums" title={exact(bv)}>
                  {fmt(bv)}
                </td>,
                <td
                  key={`${m}-d`}
                  className={`py-1.5 pr-3 text-right tabular-nums ${
                    ratio == null ? 'text-muted-foreground' : ratio >= 1 ? 'text-good' : 'text-bad'
                  }`}
                  title={ratio == null ? 'no comparable pair' : `${a} ran at ${ratio.toFixed(3)}× of ${b}`}
                >
                  {ratio == null ? '—' : `${ratio >= 1 ? '▲' : '▼'} ${ratio.toFixed(2)}×`}
                </td>,
              ];
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
