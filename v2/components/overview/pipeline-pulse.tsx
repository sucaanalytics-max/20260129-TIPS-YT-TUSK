import type { OpsRunRow } from '@/lib/queries';

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-400',
  partial: 'bg-amber-400',
  failed: 'bg-red-400',
  running: 'bg-blue-400 animate-pulse',
};

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'in future';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function PipelinePulse({ runs }: { runs: OpsRunRow[] }) {
  if (!runs.length) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Pipeline pulse</h3>
        <p className="text-muted-foreground mt-2 text-xs">no recent runs</p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Pipeline pulse</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">last 5 cron runs</p>
      <ul className="mt-3 space-y-1.5">
        {runs.slice(0, 5).map((r) => (
          <li
            key={r.run_id}
            className="flex items-baseline gap-3 text-xs"
            title={r.detail ? JSON.stringify(r.detail) : undefined}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[r.status] ?? 'bg-muted'}`}
            />
            <span className="text-muted-foreground w-32 shrink-0 uppercase tracking-wider">
              {r.source}
            </span>
            <span className="text-foreground flex-1 tabular-nums">
              {r.status}
              {r.rows_out != null ? (
                <span className="text-muted-foreground"> · {r.rows_out.toLocaleString()} rows</span>
              ) : null}
            </span>
            <span className="text-muted-foreground tabular-nums w-16 shrink-0 text-right">
              {ago(r.ended_at ?? r.started_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
