import type { FreshnessRow } from '@/lib/queries';

export function FreshnessBadge({ status }: { status: FreshnessRow[] }) {
  const stalest = status
    .filter((r) => r.latest_date)
    .map((r) => ({ ...r, age: ageInDays(r.latest_date!) }))
    .sort((a, b) => b.age - a.age)[0];

  if (!stalest) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
        <span className="bg-muted h-2 w-2 rounded-full" />
        no pipeline data yet
      </span>
    );
  }

  const colour =
    stalest.age <= 1 ? 'bg-emerald-400' : stalest.age <= 3 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <span className={`h-2 w-2 rounded-full ${colour}`} />
      latest {stalest.source} · {stalest.latest_date} · {stalest.age}d ago
    </span>
  );
}

function ageInDays(isoDate: string): number {
  const then = new Date(isoDate + 'T00:00:00Z').getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}
