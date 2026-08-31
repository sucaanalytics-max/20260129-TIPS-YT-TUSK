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

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/**
 * Period-over-period totals.
 *
 * Two numbers are deliberately withheld rather than printed.
 *
 * A comparison spanning the 2026-02-16 regime change is marked not-like-for-like:
 * a 4-figure YoY move that is really a change of instrument is one of the most
 * misleading things this page could show.
 *
 * A comparison where either side is a PART period — the quarter still in flight,
 * or the stub at the start of the series — prints no percentage at all. On
 * 2026-08-31 a flat business would otherwise render as "-33.0%" in red purely
 * because 2026-Q3 holds 61 of its 92 days. The Days column shows the
 * denominator, and an explicit like-for-like figure over the days both periods
 * measured is offered underneath — never as a silent stand-in for the
 * whole-period change.
 */
export function PeriodComparison({ sets }: { sets: PeriodComparisonSet[] }) {
  if (sets.length === 0) return null;
  const { metric, granularity } = sets[0];

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3">
        <h3 className="text-foreground text-sm font-medium">
          {METRIC_LABEL[metric]} by calendar {granularity}
        </h3>
        <p className="text-muted-foreground text-xs">
          period-over-period · part periods and rows crossing {REGIME_BREAK} are flagged
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
                  <th className="py-1.5 pr-3 text-right font-medium">Days</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Total</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Δ</th>
                  <th className="py-1.5 font-medium">Basis</th>
                </tr>
              </thead>
              <tbody>
                {[...set.periods].reverse().map((p) => (
                  <tr key={p.key} className="border-border/30 border-b last:border-0">
                    <td className="text-foreground py-1.5 pr-3 tabular-nums">{p.key}</td>

                    {/* The denominator. 61/92 is why a Δ is missing; 88/91 is a
                        complete quarter carrying frozen-reading NULLs. */}
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        !p.complete ? 'text-warning' : 'text-muted-foreground/70'
                      }`}
                      title={
                        !p.complete
                          ? `Part period: ${p.days + p.missing} of ${p.expectedDays} calendar days have a reading (through day ${p.elapsedDays}, ${p.to}).`
                          : p.missing > 0
                            ? `${p.missing} day${p.missing === 1 ? '' : 's'} in this period had no reading.`
                            : `All ${p.expectedDays} days measured.`
                      }
                    >
                      {p.days}/{p.expectedDays}
                    </td>

                    <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">
                      {fmt(p.total)}
                    </td>

                    <td className="py-1.5 pr-3 text-right tabular-nums" title={p.caveat ?? ''}>
                      {p.changePct == null ? (
                        <>
                          <span className="text-muted-foreground">—</span>
                          {p.partialChangePct != null && p.sharedDays != null ? (
                            <div className="text-muted-foreground/70 text-[10px] leading-tight">
                              {pct(p.partialChangePct)} <span className="opacity-70">like-for-like</span>
                              <div className="opacity-60">on {p.sharedDays}d both measured</div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span
                          className={
                            !p.comparable
                              ? 'text-warning'
                              : p.changePct >= 0
                                ? 'text-good'
                                : 'text-critical'
                          }
                        >
                          {pct(p.changePct)}
                        </span>
                      )}
                    </td>

                    <td className="py-1.5">
                      {p.regime === 'mixed' ? (
                        <span
                          className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
                          title={p.caveat ?? ''}
                        >
                          mixed
                        </span>
                      ) : p.regime === 'legacy' ? (
                        <span className="text-muted-foreground/70 text-[10px]">legacy</span>
                      ) : (
                        <span className="text-muted-foreground/70 text-[10px]">per-channel</span>
                      )}
                      {!p.complete ? (
                        <span
                          className="ml-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
                          title={p.caveat ?? `Part period: ${p.days + p.missing} of ${p.expectedDays} days.`}
                        >
                          part period
                        </span>
                      ) : null}
                      {/* The regime break is not a completeness problem and does not
                          clear when the period closes, so this must show even on a
                          part period — otherwise the amber chip alone implies the Δ
                          will arrive later, and it never will. */}
                      {!p.comparable && p.regime !== 'mixed' ? (
                        <span className="ml-1 text-warning" title={p.caveat ?? ''}>
                          ⚠
                        </span>
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
        Days is measured days over the calendar length of the period. A period that does not
        hold every day — the one still in flight, or the stub at the start of the series — gets
        no period-over-period percentage: two-thirds of a quarter against a whole one reads as a
        collapse that never happened. Where the only obstacle is completeness, a like-for-like
        change over the days both periods measured is shown beneath the dash instead.
        Before {REGIME_BREAK} the series is one synthetic aggregate row per day; after it, real
        per-channel data, so a percentage spanning the change is partly a change of instrument
        and is marked rather than printed as if it were like-for-like. Buckets are calendar
        quarters and calendar years, not the Apr–Mar fiscal year used for filings.
      </p>
    </div>
  );
}
