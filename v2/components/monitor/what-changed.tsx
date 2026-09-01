import type { SignalCell, SignalsSnapshot } from '@/lib/signals';
import { Card, CardHead } from '@/components/shell/app-shell';
import { Sparkline } from '@/components/charts/sparkline';

interface Row {
  key: string;
  label: string;
  value: string;
  sigma: number | null;
  tone: 'good' | 'warn' | 'bad' | 'muted';
  spark: Array<number | null>;
  note: string;
}

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);

const compact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
};

/**
 * Tone follows DIRECTION, not sign — a falling freshness score and a falling
 * price are both "down", but only some of them are bad. A cell that is not
 * significant reads muted whatever its sigma, so an insignificant move never
 * borrows the authority of a coloured one.
 */
function toneOf(cell: SignalCell): Row['tone'] {
  if (!cell.significant || cell.value == null) return 'muted';
  if (cell.direction === 'up') return 'good';
  if (cell.direction === 'down') return 'bad';
  return 'warn';
}

function rowsFor(snap: SignalsSnapshot): Row[] {
  const c = snap.company;
  const mk = (
    key: string,
    label: string,
    cell: SignalCell,
    value: string,
    note: string,
  ): Row => ({
    key: `${c}:${key}`,
    label: `${c} · ${label}`,
    value,
    sigma: cell.sigma ?? null,
    tone: toneOf(cell),
    spark: cell.sparkline ?? [],
    note: cell.caveat ? `${note} ${cell.caveat}` : note,
  });

  return [
    mk('views', 'daily views', snap.viewMomentum, compact(snap.viewMomentum.value),
      'View momentum against this company’s own 365-day history, not against the sector.'),
    mk('subs', 'subscriber drift', snap.subscriberDrift, compact(snap.subscriberDrift.value),
      'YouTube quantises subscriber counts to the nearest thousand, so single-day moves under ~10k are reporting noise rather than signal.'),
    mk('fresh', 'catalog freshness', snap.catalogFreshness, fmt(snap.catalogFreshness.value),
      'Share of views coming from recent uploads. A falling score means the back catalogue is carrying more of the load.'),
    mk('leadlag', 'lead-lag r', snap.leadLag, fmt(snap.leadLag.value),
      snap.leadLag.significant
        ? `Best lag ${snap.leadLag.lagDays ?? '—'}d. Positive lag means views lead price.`
        : 'Does not clear the significance floor at any lag in this window, so it is drawn neutral and carries no weight in the read.'),
    mk('rel', 'relative strength', snap.relativeStrength, `${fmt(snap.relativeStrength.value, 1)}%`,
      'Price performance against the index over the window.'),
    mk('peer', 'peer rank', snap.peerRankMomentum, fmt(snap.peerRankMomentum.value, 0),
      'Movement in the channel’s rank among tracked peers.'),
  ];
}

const DOT: Record<Row['tone'], string> = {
  good: 'rgb(var(--good))',
  warn: 'rgb(var(--warn))',
  bad: 'rgb(var(--bad))',
  muted: 'rgb(var(--muted))',
};
const TEXT: Record<Row['tone'], string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  muted: 'text-muted-foreground',
};

/**
 * Everything that moved, ranked by how far it moved relative to its own
 * history. Ranking by |σ| rather than by raw size is the whole point: a 3σ move
 * on a small channel is more informative than a 1% wobble on a large one.
 */
export function WhatChanged({ snapshots }: { snapshots: SignalsSnapshot[] }) {
  const rows = snapshots
    .flatMap(rowsFor)
    .filter((r) => r.sigma != null)
    .sort((a, b) => Math.abs(b.sigma ?? 0) - Math.abs(a.sigma ?? 0))
    .slice(0, 8);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHead title="What changed" note="ranked by |σ|" />
        <p className="text-muted-foreground p-pad text-sm">
          No signal has enough history to score yet. Nothing is being hidden — the window simply
          does not contain enough measured days.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead title="What changed">
        <span className="text-muted-foreground font-mono text-[11px]">ranked by |σ|</span>
      </CardHead>
      <ul className="m-0 list-none p-0">
        {rows.map((r, i) => (
          <li key={r.key} className={i < rows.length - 1 ? 'border-border border-b' : ''}>
            <details>
              <summary
                className="grid items-center gap-3 px-pad py-row"
                style={{ gridTemplateColumns: '14px minmax(0,1fr) 90px 96px 64px 14px' }}
              >
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: DOT[r.tone] }} />
                <span className="truncate text-[13px] font-medium">{r.label}</span>
                <span className="text-muted-foreground font-mono text-xs">{r.value}</span>
                <Sparkline values={r.spark} width={96} height={18} color={DOT[r.tone]} />
                <span className={`text-right font-mono text-xs ${TEXT[r.tone]}`}>
                  {r.sigma == null
                    ? '—'
                    : `${r.sigma >= 0 ? '+' : ''}${r.sigma.toFixed(1)}σ`}
                </span>
                <span className="chev text-muted-foreground transition-transform duration-150">
                  ›
                </span>
              </summary>
              <p className="text-ink2 m-0 max-w-[78ch] pb-pad pl-[46px] pr-pad text-xs leading-relaxed">
                {r.note}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}
