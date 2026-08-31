import type { SignalsSnapshot } from '@/lib/signals';
import { SignalTile } from './signal-tile';

/**
 * Eight metrics, each in its own labelled tile — small multiples, not eight
 * series on one axis. There is no shared scale for a hue to identify against,
 * so every sparkline draws in the tile default (ink) rather than cycling eight
 * colours past the three-slot categorical ceiling.
 */
const COLS = [
  { key: 'viewMomentum', label: 'View momentum', fmt: 'sigma' as const },
  { key: 'catalogFreshness', label: 'Catalog fresh', fmt: 'ratio' as const },
  { key: 'leadLag', label: 'Lead-lag r', fmt: 'r' as const },
  { key: 'relativeStrength', label: 'Rel. strength', fmt: 'pct' as const },
  { key: 'divergence', label: 'Divergence', fmt: 'sigma' as const },
  { key: 'subscriberDrift', label: 'Subs drift', fmt: 'sigma' as const },
  { key: 'peerRankMomentum', label: 'Peer rank Δ', fmt: 'count' as const },
  { key: 'liveEventDensity', label: 'Live events 30d', fmt: 'count' as const },
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
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
