import type { EarningsRow } from '@/lib/queries';

export function EarningsTable({ rows, multi }: { rows: EarningsRow[]; multi?: boolean }) {
  if (!rows.length) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Earnings calendar</h3>
        <p className="text-muted-foreground mt-2 text-xs">no upcoming or recent results</p>
      </div>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Earnings calendar</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">past + upcoming results</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-3">Event date</th>
              {multi ? <th className="py-2 pr-3">Symbol</th> : null}
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 pr-3">Board meeting</th>
              <th className="py-2 pr-3">Results</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const upcoming = r.event_date > today;
              return (
                <tr
                  key={`${r.symbol}-${r.event_date}`}
                  className="border-border/40 border-b last:border-0"
                >
                  <td className="text-foreground tabular-nums py-2 pr-3">
                    {r.event_date}
                    {upcoming ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-blue-200">
                        upcoming
                      </span>
                    ) : null}
                  </td>
                  {multi ? (
                    <td className="text-muted-foreground py-2 pr-3">{r.symbol}</td>
                  ) : null}
                  <td className="text-foreground py-2 pr-3">{r.period}</td>
                  <td className="text-muted-foreground tabular-nums py-2 pr-3">
                    {r.board_meeting_date ?? '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {r.results_pdf_url ? (
                      <a
                        href={r.results_pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:underline"
                      >
                        PDF ↗
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
