import { Sparkline } from '@/components/charts/sparkline';

interface RankPoint {
  asof: string;
  subs_rank: number | null;
  sb_rank: number | null;
}

interface CompanyTrajectory {
  company: string;
  points: RankPoint[];
}

/**
 * Side-by-side sparklines of subs_rank trajectory per company. Lower
 * rank-number is better — visually we invert the Sparkline values so a rising
 * line on screen still means "climbing peers." The latest rank + the 30d
 * delta are surfaced as text.
 */
export function RankTrajectoryStrip({ trajectories }: { trajectories: CompanyTrajectory[] }) {
  if (trajectories.every((t) => t.points.length === 0)) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Subscriber rank · 180d</h3>
        <p className="text-muted-foreground mt-2 text-xs">
          no SocialBlade snapshots yet — first weekly cron run pending
        </p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-foreground text-sm font-medium">Subscriber rank · 180d</h3>
        <p className="text-muted-foreground text-xs">
          lower rank = better · inverted on display so rising = climbing peers
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {trajectories.map((t) => {
          const ranks = t.points
            .filter((p) => p.subs_rank != null)
            .map((p) => p.subs_rank as number);
          const latest = ranks[ranks.length - 1] ?? null;
          // Find an anchor ~30 days back
          let delta: number | null = null;
          if (t.points.length >= 4 && latest != null) {
            const latestT = new Date(t.points[t.points.length - 1].asof + 'T00:00:00Z').getTime();
            const anchor = t.points
              .filter((p) => p.subs_rank != null)
              .find(
                (p) =>
                  latestT - new Date(p.asof + 'T00:00:00Z').getTime() >= 30 * 86_400_000,
              );
            if (anchor?.subs_rank != null) delta = (anchor.subs_rank as number) - latest;
          }
          // Invert for display so improving rank goes up
          const max = ranks.length ? Math.max(...ranks) : 0;
          const inverted = ranks.map((r) => (max != null ? max - r : 0));
          const deltaColor =
            delta == null
              ? 'text-muted-foreground'
              : delta > 0
                ? 'text-emerald-400'
                : delta < 0
                  ? 'text-red-400'
                  : 'text-muted-foreground';
          return (
            <div key={t.company} className="border-border/40 rounded-md border p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-foreground text-xs font-semibold tracking-tight">
                  {t.company}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {t.points.length} snapshots
                </span>
              </div>
              <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
                {latest != null ? `#${latest.toLocaleString()}` : '—'}
              </p>
              <p className={`text-xs tabular-nums ${deltaColor}`}>
                {delta == null
                  ? '—'
                  : delta > 0
                    ? `▲ climbed ${delta} positions (30d)`
                    : delta < 0
                      ? `▼ dropped ${Math.abs(delta)} positions (30d)`
                      : 'unchanged (30d)'}
              </p>
              <div className="mt-2">
                <Sparkline
                  values={inverted.length > 0 ? inverted : [null]}
                  width={240}
                  height={36}
                  color={t.company === 'TIPSMUSIC' ? '#60a5fa' : '#a78bfa'}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
