import type { DualSymbolHeadlineRow } from '@/lib/queries';
import { Sparkline } from '@/components/charts/sparkline';
import { STOCK_RANGE_LABEL } from '@/lib/stock-range';

function fmtInt(n: number | null): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return `₹${n.toFixed(2)}`;
}

/** Format a log-return-style value as a percentage (multiplied by 100). */
function fmtLogPct(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

/** Format an already-percent value (e.g. views delta_pct). */
function fmtPct(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function deltaColor(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

function CompanyRow({ row }: { row: DualSymbolHeadlineRow }) {
  const rangeLabel = STOCK_RANGE_LABEL[row.range];
  const viewsHint =
    row.range === 'all'
      ? 'YoY (last 365d vs prior 365d)'
      : `${row.views_window_days}d avg vs prior ${row.views_window_days}d`;
  return (
    <div className="contents">
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {row.company} · close
        </p>
        <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
          {fmtPrice(row.close)}
        </p>
        <p className={`mt-1 text-xs tabular-nums ${deltaColor(row.close_return)}`}>
          {fmtLogPct(row.close_return)}{' '}
          <span className="text-muted-foreground">{rangeLabel} return (log)</span>
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Daily views (latest)
        </p>
        <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
          {fmtInt(row.daily_views_latest)}
        </p>
        <p className={`mt-1 text-xs tabular-nums ${deltaColor(row.views_delta_pct)}`}>
          {fmtPct(row.views_delta_pct)} <span className="text-muted-foreground">{viewsHint}</span>
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Subscribers
        </p>
        <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
          {fmtInt(row.subscribers)}
        </p>
        <p className={`mt-1 text-xs tabular-nums ${deltaColor(row.subs_delta)}`}>
          {row.subs_delta != null
            ? `${row.subs_delta >= 0 ? '+' : ''}${fmtInt(row.subs_delta)}`
            : '—'}{' '}
          <span className="text-muted-foreground">{rangeLabel} Δ</span>
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Views · {rangeLabel} trend
        </p>
        <div className="mt-3">
          <Sparkline
            values={row.sparkline}
            width={200}
            height={48}
            color={row.company === 'TIPSMUSIC' ? '#60a5fa' : '#a78bfa'}
          />
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          as of {row.latest_date ?? '—'}
        </p>
      </div>
    </div>
  );
}

export function DualSymbolKpiStrip({ rows }: { rows: DualSymbolHeadlineRow[] }) {
  if (!rows.length) {
    return (
      <div className="text-muted-foreground border-border bg-card/50 rounded-lg border p-6 text-sm">
        no headline data yet
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {rows.map((row) => (
        <CompanyRow key={row.company} row={row} />
      ))}
    </div>
  );
}
