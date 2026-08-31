import { Sparkline } from '@/components/charts/sparkline';
import { INK, NEUTRAL, STATUS } from '@/lib/chart-palette';
import type { SignalCell } from '@/lib/signals';

type Fmt = 'sigma' | 'pct' | 'ratio' | 'r' | 'count' | 'none';

/**
 * Direction is carried by the glyph AND by the word beside it — the colour is
 * a reinforcement, never the only channel, because up/down is exactly the
 * red-green axis a colour-blind reader loses.
 */
const ARROW: Record<SignalCell['direction'], string> = {
  up: '▲',
  down: '▼',
  flat: '◆',
};

const ARROW_WORD: Record<SignalCell['direction'], string> = {
  up: 'up',
  down: 'down',
  flat: 'flat',
};

const ARROW_COLOR: Record<SignalCell['direction'], string> = {
  up: STATUS.good,
  down: STATUS.critical,
  flat: NEUTRAL,
};

function fmtValue(cell: SignalCell, fmt: Fmt): string {
  if (cell.warming) return 'warm';
  if (cell.value == null) return '—';
  switch (fmt) {
    case 'sigma':
      return `${cell.sigma != null && cell.sigma >= 0 ? '+' : ''}${(cell.sigma ?? 0).toFixed(1)}σ`;
    case 'pct':
      return `${cell.value >= 0 ? '+' : ''}${(cell.value * 100).toFixed(1)}%`;
    case 'ratio':
      return `${Math.round(cell.value * 100)}%`;
    case 'r':
      return `${cell.value >= 0 ? '+' : ''}${cell.value.toFixed(2)}`;
    case 'count':
      return Number(cell.value).toLocaleString();
    default:
      return String(cell.value);
  }
}

export function SignalTile({
  label,
  cell,
  fmt = 'sigma',
  sparkColor = INK,
}: {
  label: string;
  cell: SignalCell;
  fmt?: Fmt;
  sparkColor?: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-foreground text-lg font-semibold tabular-nums">
          {fmtValue(cell, fmt)}
        </span>
        <span className="text-xs" style={{ color: ARROW_COLOR[cell.direction] }}>
          {ARROW[cell.direction]} {ARROW_WORD[cell.direction]}
        </span>
        {cell.significant ? (
          <span
            className="text-xs"
            style={{ color: STATUS.good }}
            title="statistically significant"
          >
            ✓ sig
          </span>
        ) : null}
      </div>
      {cell.caveat ? (
        <p className="text-muted-foreground mt-0.5 text-[10px]" title={cell.caveat}>
          ⓘ caveat
        </p>
      ) : null}
      {cell.sparkline && cell.sparkline.length > 0 ? (
        <div className="mt-2">
          <Sparkline values={cell.sparkline} width={120} height={20} color={sparkColor} />
        </div>
      ) : null}
    </div>
  );
}
