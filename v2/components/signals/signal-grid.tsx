import type { SignalsSnapshot } from '@/lib/signals';
import { SignalTile } from './signal-tile';

const COLS = [
  { key: 'viewMomentum', label: 'View momentum', fmt: 'sigma' as const, color: '#60a5fa' },
  { key: 'catalogFreshness', label: 'Catalog fresh', fmt: 'ratio' as const, color: '#a78bfa' },
  { key: 'leadLag', label: 'Lead-lag r', fmt: 'r' as const, color: '#10b981' },
  { key: 'relativeStrength', label: 'Rel. strength', fmt: 'pct' as const, color: '#f59e0b' },
  { key: 'divergence', label: 'Divergence', fmt: 'sigma' as const, color: '#ef4444' },
  { key: 'subscriberDrift', label: 'Subs drift', fmt: 'sigma' as const, color: '#94a3b8' },
  { key: 'peerRankMomentum', label: 'Peer rank Δ', fmt: 'count' as const, color: '#22d3ee' },
  { key: 'liveEventDensity', label: 'Live events 30d', fmt: 'count' as const, color: '#f472b6' },
] as const;

export function SignalGrid({ snapshots }: { snapshots: SignalsSnapshot[] }) {
  return (
    <section className="space-y-3">
      {snapshots.map((snap) => (
        <div key={snap.company}>
          <div className="mb-1.5 flex items-baseline gap-3">
            <h3 className="text-foreground text-sm font-semibold tracking-tight">
              {snap.company}
            </h3>
            <p className="text-muted-foreground text-xs">
              {snap.asOf ? `as of ${snap.asOf}` : 'no data'} ·{' '}
              {snap.daysAvailable} days of data
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {COLS.map((col) => (
              <SignalTile
                key={col.key}
                label={col.label}
                cell={snap[col.key]}
                fmt={col.fmt}
                sparkColor={col.color}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
