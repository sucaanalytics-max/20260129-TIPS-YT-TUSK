import type { DualSymbolHeadlineRow } from '@/lib/queries';
import { Sparkline } from '@/components/charts/sparkline';

function fmtInt(n: number | null): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return `₹${n.toFixed(2)}`;
}

function fmtPct(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function deltaColor(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

function CompanyRow({ row }: { row: DualSymbolHeadlineRow }) {
  return (
    <div className="contents">
      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {row.company} · close
        </p>
        <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
          {fmtPrice(row.close)}
        </p>
        <p className={`mt-1 text-xs tabular-nums ${deltaColor(row.close_delta_pct)}`}>
          {fmtPct(row.close_delta_pct)} <span className="text-muted-foreground">1d</span>
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
          {fmtPct(row.views_delta_pct)} <span className="text-muted-foreground">7d avg vs prior 7d</span>
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Subscribers
        </p>
        <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
          {fmtInt(row.subscribers)}
        </p>
        <p className={`mt-1 text-xs tabular-nums ${deltaColor(row.subscribers_yoy_delta)}`}>
          {row.subscribers_yoy_delta != null
            ? `${row.subscribers_yoy_delta >= 0 ? '+' : ''}${fmtInt(row.subscribers_yoy_delta)}`
            : '—'}{' '}
          <span className="text-muted-foreground">YoY</span>
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          Views · 60d trend
        </p>
        <div className="mt-3">
          <Sparkline
            values={row.sparkline_60d}
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
