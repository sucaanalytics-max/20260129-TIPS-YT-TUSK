import type { OpsRunRow } from '@/lib/queries';

const STATUS_COLOR: Record<string, string> = {
  ok: 'text-emerald-400',
  partial: 'text-amber-400',
  failed: 'text-red-400',
  running: 'text-blue-400',
};

export function RunHistory({ runs }: { runs: OpsRunRow[] }) {
  if (!runs.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no recent runs
      </div>
    );
  }
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Run</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3 text-right">Duration</th>
            <th className="px-4 py-3 text-right">In</th>
            <th className="px-4 py-3 text-right">Out</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const duration =
              r.ended_at && r.started_at
                ? `${Math.round((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000)}s`
                : '—';
            return (
              <tr key={r.run_id} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
                <td className="text-muted-foreground px-4 py-2 font-mono text-xs">#{r.run_id}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.source}</td>
                <td className={`px-4 py-2 text-xs uppercase ${STATUS_COLOR[r.status] ?? 'text-muted-foreground'}`}>
                  {r.status}
                </td>
                <td className="text-muted-foreground px-4 py-2 text-xs">{r.started_at.replace('T', ' ').slice(0, 19)}</td>
                <td className="text-muted-foreground px-4 py-2 text-right text-xs tabular-nums">{duration}</td>
                <td className="px-4 py-2 text-right text-xs tabular-nums">{r.rows_in ?? '—'}</td>
                <td className="px-4 py-2 text-right text-xs tabular-nums">{r.rows_out ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
