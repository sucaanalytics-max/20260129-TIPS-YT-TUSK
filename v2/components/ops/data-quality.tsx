import type { DataQualitySnapshot } from '@/lib/queries';

/**
 * Where the view series was repaired rather than measured.
 *
 * YouTube's Data API intermittently serves a stale cumulative viewCount — the
 * same number for consecutive days across every channel — then unfreezes with
 * the whole backlog in one reading. Those days are correct in TOTAL but
 * interpolated per-day, and this panel exists so that is never silently passed
 * off as measured data.
 */
export function DataQuality({ snapshot }: { snapshot: DataQualitySnapshot }) {
  const { days, imputed_channel_days, unresolved_channels } = snapshot;

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">View-series repairs</h3>
          <p className="text-muted-foreground text-xs">
            days spread from a multi-day catch-up after YouTube served a stale cumulative
            count · correct in total, interpolated per day
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unresolved_channels > 0 ? (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
              {unresolved_channels} frozen today
            </span>
          ) : (
            <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] text-good">
              nothing frozen today
            </span>
          )}
          <span className="text-muted-foreground text-[11px] tabular-nums">
            since {snapshot.since}
          </span>
        </div>
      </header>

      {days.length === 0 ? (
        <p className="text-muted-foreground/80 text-xs">
          No repaired days in this window — every value is a measured 1-day delta.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mb-2 text-[11px] tabular-nums">
            {imputed_channel_days.toLocaleString()} channel-days repaired across{' '}
            {new Set(days.map((d) => d.date)).size} dates
          </p>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground border-border/60 sticky top-0 border-b">
                <tr className="bg-card">
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 pr-3 font-medium">Company</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Channels</th>
                  <th className="py-1.5 text-right font-medium">Span</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr
                    key={`${d.date}|${d.company ?? '-'}`}
                    className="border-border/30 border-b last:border-0"
                  >
                    <td className="text-foreground py-1.5 pr-3 tabular-nums">{d.date}</td>
                    <td className="text-muted-foreground py-1.5 pr-3">{d.company ?? '—'}</td>
                    <td className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums">
                      {d.channels_affected}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      <span
                        className={
                          d.max_span_days >= 7 ? 'text-warning' : 'text-muted-foreground'
                        }
                        title={`The catch-up delta covered ${d.max_span_days} days`}
                      >
                        {d.max_span_days}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-muted-foreground/70 mt-3 text-[11px]">
        Repairs preserve the period total exactly — only the per-day split is inferred.
        Cumulative <code className="font-mono">total_views</code>, the raw API reading, is
        never modified.
      </p>
    </div>
  );
}
