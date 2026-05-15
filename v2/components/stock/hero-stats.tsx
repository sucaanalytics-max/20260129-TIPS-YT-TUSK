import type { StockDeepDive } from '@/lib/queries';

function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return `₹${n.toFixed(2)}`;
}

function fmtPct(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

function deltaColor(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

export function HeroStats({ deepDive }: { deepDive: StockDeepDive }) {
  const prices = deepDive.prices;
  const latest = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const close = latest?.close ?? null;
  const dailyPct =
    close != null && prev?.close != null && prev.close > 0
      ? Math.log(close / prev.close)
      : null;

  const range = deepDive.fiftyTwoWeek;

  // 1y return from adjusted closes
  const oneYearAgoMs = latest
    ? new Date(latest.date + 'T00:00:00Z').getTime() - 365 * 86_400_000
    : null;
  let oneYearReturn: number | null = null;
  if (latest && oneYearAgoMs != null && latest.adjusted_close != null) {
    const anchor = [...prices]
      .reverse()
      .find(
        (p) =>
          p.adjusted_close != null &&
          new Date(p.date + 'T00:00:00Z').getTime() <= oneYearAgoMs,
      );
    if (anchor && anchor.adjusted_close != null && anchor.adjusted_close > 0) {
      oneYearReturn = Math.log(latest.adjusted_close / anchor.adjusted_close);
    }
  }

  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <div className="grid gap-6 sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {deepDive.symbol} · close
          </p>
          <p className="text-foreground mt-2 text-3xl font-semibold tabular-nums">
            {fmtPrice(close)}
          </p>
          <p className={`mt-1 text-xs tabular-nums ${deltaColor(dailyPct)}`}>
            {fmtPct(dailyPct)} <span className="text-muted-foreground">1d (log)</span>
          </p>
          {latest ? (
            <p className="text-muted-foreground mt-2 text-xs">as of {latest.date}</p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            52-week range
          </p>
          {range ? (
            <>
              <div className="border-border bg-muted/30 relative mt-3 h-2 overflow-hidden rounded-full">
                <div
                  className="absolute top-0 h-full w-1 -translate-x-1/2 bg-blue-400"
                  style={{ left: `${(range.position_pct * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="text-muted-foreground mt-1.5 flex justify-between text-xs tabular-nums">
                <span>Low ₹{range.low.toFixed(2)}</span>
                <span>High ₹{range.high.toFixed(2)}</span>
              </div>
              <p className="text-foreground mt-1 text-xs">
                Position: {(range.position_pct * 100).toFixed(0)}% of range
              </p>
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">insufficient data</p>
          )}
        </div>

        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            1y return
          </p>
          <p className={`mt-2 text-3xl font-semibold tabular-nums ${deltaColor(oneYearReturn)}`}>
            {fmtPct(oneYearReturn)}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">log return on adj close</p>
        </div>
      </div>
    </div>
  );
}
