import type { EventTimelineRow, OpsRunRow } from '@/lib/queries';
import { Card, CardHead } from '@/components/shell/app-shell';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pretty(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Upcoming earnings, releases and corporate actions. */
export function EventsCard({ events, today }: { events: EventTimelineRow[]; today: string }) {
  const t0 = Date.parse(`${today}T00:00:00Z`);

  return (
    <Card>
      <CardHead title="Next 14 days" />
      {events.length === 0 ? (
        <p className="text-muted-foreground px-pad pb-pad pt-1 text-[13px]">
          Nothing scheduled in the window.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 px-pad pb-pad pt-1">
          {events.slice(0, 6).map((e) => {
            const days = Math.round((Date.parse(`${e.event_date}T00:00:00Z`) - t0) / DAY);
            // The nearest event is the one worth looking at, so only it is accented.
            const imminent = days <= 3;
            return (
              <li key={e.event_id} className="grid items-baseline gap-3" style={{ gridTemplateColumns: '38px minmax(0,1fr)' }}>
                <span
                  className={`font-mono text-[11px] font-medium ${imminent ? 'text-accent' : 'text-muted-foreground'}`}
                >
                  {days <= 0 ? 'today' : `+${days}d`}
                </span>
                <span>
                  <span className="block text-[13px]">
                    {e.company ? `${e.company} · ` : ''}
                    {e.label}
                  </span>
                  <span className="text-muted-foreground block font-mono text-[11px]">
                    {e.event_type} · {pretty(e.event_date)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const STATUS_DOT: Record<string, string> = {
  ok: 'rgb(var(--good))',
  partial: 'rgb(var(--warn))',
  error: 'rgb(var(--bad))',
  failed: 'rgb(var(--bad))',
  running: 'rgb(var(--accent))',
};

function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'now';
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The whole Ops page, folded into one card.
 *
 * Anything that is not `ok` is named with a word beside its dot. The August
 * outage ran for four days as `partial` while the dashboard looked fine, so a
 * degraded run has to be legible here or it is invisible everywhere.
 */
export function PipelineCard({ runs, now }: { runs: OpsRunRow[]; now: number }) {
  const latest = new Map<string, OpsRunRow>();
  for (const r of runs) if (!latest.has(r.source)) latest.set(r.source, r);
  const rows = [...latest.values()]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 6);
  const degraded = [...latest.values()].filter((r) => r.status !== 'ok').length;

  return (
    <Card>
      <CardHead title="Pipeline">
        <span className={`font-mono text-[11px] ${degraded > 0 ? 'text-warn' : 'text-good'}`}>
          {degraded === 0 ? 'all ok' : `${degraded} degraded`}
        </span>
      </CardHead>
      <ul className="m-0 flex list-none flex-col gap-2 px-pad pb-pad pt-1 font-mono text-[11px]">
        {rows.map((r) => {
          const running = r.ended_at == null;
          return (
            <li key={r.source} className="flex items-center gap-2.5">
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{
                  background: running
                    ? STATUS_DOT.running
                    : (STATUS_DOT[r.status] ?? 'rgb(var(--muted))'),
                  animation: running ? 'breathe 2s infinite' : undefined,
                }}
              />
              <span className="text-ink2 flex-1 truncate">
                {r.source}
                {r.status !== 'ok' ? ` · ${r.status}` : ''}
              </span>
              <span className="text-muted-foreground">
                {running ? 'now' : ago(r.ended_at ?? r.started_at, now)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
