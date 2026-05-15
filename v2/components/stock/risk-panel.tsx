import type { RiskMetrics } from '@/lib/queries';

function fmtPct(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtBeta(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(2);
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
      <span className="text-foreground tabular-nums text-sm font-medium">
        {value}
        {hint ? (
          <span className="text-muted-foreground ml-2 text-xs">{hint}</span>
        ) : null}
      </span>
    </div>
  );
}

export function RiskPanel({ metrics }: { metrics: RiskMetrics[] }) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Risk · trailing {metrics[0]?.window_days ?? 252}d</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">vol annualized · beta vs daily index returns</p>
      <div className={`mt-3 grid gap-6 ${metrics.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {metrics.map((m) => (
          <div key={m.symbol}>
            {metrics.length > 1 ? (
              <p className="text-foreground mb-1 text-xs font-semibold tracking-tight">
                {m.symbol}
              </p>
            ) : null}
            <Row label="Annualized vol" value={fmtPct(m.annualized_vol)} />
            <Row
              label="Max drawdown"
              value={fmtPct(m.max_drawdown_pct)}
              hint={
                m.max_drawdown_peak && m.max_drawdown_trough
                  ? `${m.max_drawdown_peak} → ${m.max_drawdown_trough}`
                  : undefined
              }
            />
            <Row label="β · NIFTY MIDCAP 150" value={fmtBeta(m.beta_midcap150)} />
            <Row label="β · NIFTY 50" value={fmtBeta(m.beta_nifty50)} />
          </div>
        ))}
      </div>
    </div>
  );
}
