import type { Bias, SignalsSnapshot } from '@/lib/signals';
import { composeRead } from '@/lib/signals';
import { Card, Disclose } from '@/components/shell/app-shell';

const TONE: Record<Bias, { accent: 'good' | 'warn' | 'bad'; glyph: string }> = {
  POSITIVE: { accent: 'good', glyph: '▲' },
  MIXED: { accent: 'warn', glyph: '●' },
  NEGATIVE: { accent: 'bad', glyph: '▼' },
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-border bg-surface2 rounded-md border px-2 py-1 font-mono text-[11px]">
      {children}
    </span>
  );
}

const sigma = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ`;

/**
 * The lead panel: one company's standing read, in a sentence.
 *
 * `composeRead` produces the bias and the sentence from the same eight signals
 * shown below it, so the headline and the chips can never tell different
 * stories. The disclosure carries the weighting, which is the only part a
 * reader needs to argue with.
 */
export function ReadCard({
  snapshot,
  price,
}: {
  snapshot: SignalsSnapshot;
  /** Latest close and 1Y change, or null where the series has not loaded. */
  price: { close: number | null; changePct1y: number | null };
}) {
  const read = composeRead(snapshot);
  const tone = TONE[read.bias];
  const unavailable = [snapshot.viewMomentum, snapshot.catalogFreshness, snapshot.leadLag,
    snapshot.relativeStrength, snapshot.divergence, snapshot.subscriberDrift,
    snapshot.peerRankMomentum, snapshot.liveEventDensity]
    .filter((c) => c.value == null || c.warming).length;

  return (
    <Card accent={tone.accent} className="p-pad">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">{snapshot.company}</span>
          <span className="text-muted-foreground font-mono text-[11px]">
            {price.close == null ? '—' : `₹${price.close.toFixed(2)}`}
            {price.changePct1y == null
              ? ''
              : ` · ${price.changePct1y >= 0 ? '+' : ''}${price.changePct1y.toFixed(1)}% 1Y`}
          </span>
        </div>
        {/* Glyph and word, never colour alone — good-vs-bad is the axis
            colour-blind readers lose. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.08em]"
          style={{ color: `rgb(var(--${tone.accent}))`, borderColor: `rgb(var(--${tone.accent}))` }}
        >
          {tone.glyph} {read.bias}
        </span>
      </div>

      <p className="m-0 text-base leading-[1.45] tracking-[-0.005em]">{read.sentence}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip>momentum {sigma(snapshot.viewMomentum.sigma)}</Chip>
        <Chip>
          {snapshot.leadLag.significant && snapshot.leadLag.value != null
            ? `r=${snapshot.leadLag.value.toFixed(2)} @ ${snapshot.leadLag.lagDays != null ? `${snapshot.leadLag.lagDays >= 0 ? '+' : ''}${snapshot.leadLag.lagDays}d` : '—'}`
            : 'r n/s'}
        </Chip>
        <Chip>
          rel{' '}
          {snapshot.relativeStrength.value == null
            ? '—'
            : `${snapshot.relativeStrength.value >= 0 ? '+' : ''}${snapshot.relativeStrength.value.toFixed(1)}%`}
        </Chip>
        <Chip>
          fresh{' '}
          {snapshot.catalogFreshness.value == null
            ? '—'
            : snapshot.catalogFreshness.value.toFixed(2)}
        </Chip>
      </div>

      <Disclose summary="How this read is composed" className="border-border mt-3 border-t pt-2.5">
        Eight measured signals are scored against their own history, weighted by significance and
        summed; the bias flips on that weighted sum. {unavailable > 0
          ? `${unavailable} of eight ${unavailable === 1 ? 'is' : 'are'} unavailable or still warming up and ${unavailable === 1 ? 'is' : 'are'} excluded rather than counted as neutral.`
          : 'All eight are available.'}{' '}
        Sector demand is graded LOW and deliberately excluded. Internal view — not research.
      </Disclose>
    </Card>
  );
}
