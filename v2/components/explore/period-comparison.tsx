import type { PeriodComparisonSet } from '@/lib/queries';
import { METRIC_LABEL } from '@/lib/metrics';
import { REGIME_BREAK } from '@/lib/period-compare';

const fmt = (n: number | null): string => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-IN');
};

/**
 * Period-over-period totals.
 *
 * Every row carries the regime it was measured in, and a comparison that spans
 * the 2026-02-16 change is marked not-like-for-like rather than being quietly
 * printed as a percentage. A 4-figure YoY move that is really a change of
 * instrument is the single most misleading number this page could show.
 */
export function PeriodComparison({ sets }: { sets: PeriodComparisonSet[] }) {
  if (sets.length === 0) return null;
  const { metric, granularity } = sets[0];

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3">
        <h3 className="text-foreground text-sm font-medium">
          {METRIC_LABEL[metric]} by {granularity}
        </h3>
        <p className="text-muted-foreground text-xs">
          period-over-period · rows crossing {REGIME_BREAK} are flagged
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {sets.map((set) => (
          <div key={set.company}>
            <div className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wider">
              {set.company}
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground border-border/60 border-b">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Period</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Δ</th>
                  <th className="py-1.5 font-medium">Basis</th>
                </tr>
              </thead>
              <tbody>
                {[...set.periods].reverse().map((p) => (
                  <tr key={p.key} className="border-border/30 border-b last:border-0">
                    <td className="text-foreground py-1.5 pr-3 tabular-nums">{p.key}</td>
                    <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">{fmt(p.total)}</td>
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        p.changePct == null
                          ? 'text-muted-foreground'
                          : !p.comparable
                            ? 'text-warning'
                            : p.changePct >= 0
                              ? 'text-good'
                              : 'text-critical'
                      }`}
                    >
                      {p.changePct == null
                        ? '—'
                        : `${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(1)}%`}
                    </td>
                    <td className="py-1.5">
                      {p.regime === 'mixed' ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning" title={p.caveat ?? ''}>
                          mixed
                        </span>
                      ) : p.regime === 'legacy' ? (
                        <span className="text-muted-foreground/70 text-[10px]">legacy</span>
                      ) : (
                        <span className="text-muted-foreground/70 text-[10px]">per-channel</span>
                      )}
                      {!p.comparable && p.regime !== 'mixed' ? (
                        <span className="ml-1 text-warning" title={p.caveat ?? ''}>⚠</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground/70 mt-3 text-[11px] leading-relaxed">
        Before {REGIME_BREAK} the series is one synthetic aggregate row per day; after it,
        real per-channel data. Totals either side are broadly comparable, but a percentage
        spanning the change is partly a change of instrument — those are marked rather than
        printed as if they were like-for-like.
      </p>
    </div>
  );
}
