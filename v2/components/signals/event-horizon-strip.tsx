import type { EventTimelineRow } from '@/lib/queries';

const TYPE_DOT: Record<string, string> = {
  earnings: 'bg-blue-400',
  release: 'bg-emerald-400',
  film_release: 'bg-violet-400',
  corp_action: 'bg-amber-400',
  annotation: 'bg-muted',
};

function daysFromNow(iso: string): number {
  const t = new Date(iso + 'T00:00:00Z').getTime();
  return Math.round((t - Date.now()) / 86_400_000);
}

export function EventHorizonStrip({ events }: { events: EventTimelineRow[] }) {
  if (events.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Event horizon · next 30d</h3>
        <p className="text-muted-foreground mt-2 text-xs">no upcoming events</p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Event horizon · next 30d</h3>
      <ul className="mt-3 space-y-1.5">
        {events.map((e) => (
          <li key={e.event_id} className="flex items-baseline gap-3 text-xs">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[e.event_type] ?? 'bg-muted'}`} />
            <span className="text-muted-foreground tabular-nums w-20 shrink-0">
              {e.event_date}
            </span>
            <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-wider">
              {e.event_type}
            </span>
            <span className="text-foreground flex-1 truncate">
              {e.company ? `${e.company} · ` : ''}
              {e.label}
            </span>
            <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-right">
              +{daysFromNow(e.event_date)}d
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
