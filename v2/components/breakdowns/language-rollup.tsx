import type { LanguageRollupRow } from '@/lib/queries';
import { formatNumber } from '@/lib/queries';

export function LanguageRollup({ rows }: { rows: LanguageRollupRow[] }) {
  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no language rollup yet
      </div>
    );
  }
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Language</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3 text-right">Channels</th>
            <th className="px-4 py-3 text-right">Subs</th>
            <th className="px-4 py-3 text-right">Total views</th>
            <th className="px-4 py-3 text-right">Avg daily views (7d)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.company}-${r.language}`} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
              <td className="px-4 py-2.5 font-medium">{r.language ?? 'unknown'}</td>
              <td className="text-muted-foreground px-4 py-2.5">{r.company}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.channel_count}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.subscribers)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.total_views)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.daily_views_7d_avg != null ? formatNumber(Math.round(r.daily_views_7d_avg)) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
