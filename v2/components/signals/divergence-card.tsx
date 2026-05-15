import type { SignalsSnapshot } from '@/lib/signals';

interface DivergenceRow {
  company: string;
  direction: 'up' | 'down' | 'flat';
  magnitude: number;
}

export function DivergenceCard({ snapshots }: { snapshots: SignalsSnapshot[] }) {
  const active: DivergenceRow[] = snapshots
    .filter((s) => s.divergence.active && s.divergence.value != null)
    .map((s) => ({
      company: s.company,
      direction: s.divergence.direction,
      magnitude: Math.abs(s.divergence.value ?? 0),
    }));

  if (active.length === 0) return null;

  return (
    <div className="border-amber-500/30 bg-amber-500/5 rounded-lg border p-4">
      <h3 className="text-amber-200 text-sm font-medium tracking-tight">
        Divergence watch
      </h3>
      <ul className="mt-2 space-y-1">
        {active.map((row) => (
          <li key={row.company} className="text-foreground text-sm">
            <span className="font-medium">{row.company}</span>:{' '}
            views {row.direction === 'up' ? '↑' : '↓'} price{' '}
            {row.direction === 'up' ? '↓' : '↑'}{' '}
            <span className="text-muted-foreground tabular-nums">
              · gap {row.magnitude.toFixed(1)}σ
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-[10px]">
        Views and price moving in opposite directions over the trailing window.
        Often a setup for catch-up; not a forecast.
      </p>
    </div>
  );
}
