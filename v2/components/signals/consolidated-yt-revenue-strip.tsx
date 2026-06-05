import type { ConsolidatedYTRevenue } from '@/lib/queries';
import { fmtInr } from '@/lib/revenue-cpm';
import { ConfidenceBadge } from './confidence-badge';

/**
 * Headline modelled YT revenue band per company, summed across all three
 * layers (Owned + Topic/OAC + UGC). This is the IR-level summary —
 * directly comparable against a broker's projected music-licensing
 * segment × industry YT-share assumption.
 *
 * Per layer: shows its individual band + confidence grade + composition %.
 * The aggregate band's confidence grade takes the worst across layers
 * (the total is only as reliable as its weakest input).
 */
export function ConsolidatedYTRevenueStrip({
  snapshots,
}: {
  snapshots: ConsolidatedYTRevenue[];
}) {
  const empty = snapshots.every((s) => s.total.weekly.mid_inr === 0);
  if (empty) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Modelled YT revenue (headline)</h3>
        <p className="text-muted-foreground mt-2 text-xs">
          no revenue data yet — view data is accumulating
        </p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            Modelled YT revenue (consolidated)
          </h3>
          <p className="text-muted-foreground text-xs">
            sum of Owned + Topic/OAC + UGC layers · IR-level headline band ·{' '}
            compare against broker music-licensing segment ×{' '}
            <span className="text-muted-foreground/80">~35% industry YT-share</span>
          </p>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {snapshots.map((s) => (
          <Card key={s.company} snap={s} />
        ))}
      </div>
    </div>
  );
}

function Card({ snap }: { snap: ConsolidatedYTRevenue }) {
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">{snap.company}</span>
        <ConfidenceBadgeForGrade grade={snap.worst_grade} />
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {fmtInr(snap.total.weekly.low_inr)} – {fmtInr(snap.total.weekly.high_inr)}
        <span className="text-muted-foreground text-xs font-normal"> /wk</span>
      </p>
      <p className="text-muted-foreground/80 text-[11px] tabular-nums">
        Q-rate {fmtInr(snap.total.quarterly.low_inr)} – {fmtInr(snap.total.quarterly.high_inr)}
        {' · '}daily {fmtInr(snap.total.daily.low_inr)} – {fmtInr(snap.total.daily.high_inr)}
      </p>
      <div className="text-muted-foreground/70 mt-1 text-[10px]">
        <CompositionBar comp={snap.composition} />
      </div>
      <div className="mt-3 space-y-1.5">
        <LayerRow
          label="Owned channels"
          symbol="◼"
          color="text-sky-400/80"
          estimate={snap.owned}
          subline={`${snap.owned_channels_count} ch · ${(snap.owned_views_7d / 1e6).toFixed(1)}M views/wk`}
        />
        <LayerRow
          label="Topic + OAC"
          symbol="◆"
          color="text-emerald-400/70"
          estimate={snap.topic}
          subline={`${(snap.composition.topic_pct_mid * 100).toFixed(1)}% of band mid`}
        />
        <LayerRow
          label="UGC Shorts"
          symbol="○"
          color="text-amber-400/70"
          estimate={snap.ugc}
          subline={`catalog-matched only · ${(snap.composition.ugc_pct_mid * 100).toFixed(2)}% of band mid`}
        />
      </div>
    </div>
  );
}

function LayerRow({
  label,
  symbol,
  color,
  estimate,
  subline,
}: {
  label: string;
  symbol: string;
  color: string;
  estimate: ConsolidatedYTRevenue['owned'];
  subline?: string;
}) {
  return (
    <div className="text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground">
          <span className={`mr-1 ${color}`} title={label}>
            {symbol}
          </span>
          {label}
        </span>
        <span className="tabular-nums shrink-0 flex items-center gap-1.5">
          <span className="text-muted-foreground">
            {fmtInr(estimate.weekly.low_inr)} – {fmtInr(estimate.weekly.high_inr)}
          </span>
          <ConfidenceBadge estimate={estimate} />
        </span>
      </div>
      {subline ? (
        <div className="text-muted-foreground/60 text-[10px]">{subline}</div>
      ) : null}
    </div>
  );
}

function CompositionBar({
  comp,
}: {
  comp: { owned_pct_mid: number; topic_pct_mid: number; ugc_pct_mid: number };
}) {
  const ownedPct = Math.max(0, Math.min(1, comp.owned_pct_mid));
  const topicPct = Math.max(0, Math.min(1, comp.topic_pct_mid));
  const ugcPct = Math.max(0, Math.min(1, comp.ugc_pct_mid));
  // Min-width display so even tiny slices remain visible
  const minVisible = 0.005;
  const showOwned = ownedPct > 0 ? Math.max(ownedPct, minVisible) : 0;
  const showTopic = topicPct > 0 ? Math.max(topicPct, minVisible) : 0;
  const showUgc = ugcPct > 0 ? Math.max(ugcPct, minVisible) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="bg-muted/20 relative flex h-1.5 w-full overflow-hidden rounded-full">
        <span
          className="bg-sky-400/70 h-full"
          style={{ width: `${showOwned * 100}%` }}
          title={`Owned: ${(ownedPct * 100).toFixed(1)}%`}
        />
        <span
          className="bg-emerald-400/70 h-full"
          style={{ width: `${showTopic * 100}%` }}
          title={`Topic+OAC: ${(topicPct * 100).toFixed(1)}%`}
        />
        <span
          className="bg-amber-400/70 h-full"
          style={{ width: `${showUgc * 100}%` }}
          title={`UGC: ${(ugcPct * 100).toFixed(2)}%`}
        />
      </span>
    </div>
  );
}

function ConfidenceBadgeForGrade({ grade }: { grade: string }) {
  const cls = gradeClass(grade);
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums font-mono ${cls}`}>
      {grade} grade
    </span>
  );
}

function gradeClass(grade: string): string {
  switch (grade) {
    case 'A':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'B':
      return 'bg-sky-500/15 text-sky-300';
    case 'C':
      return 'bg-amber-500/15 text-amber-300';
    case 'D':
      return 'bg-orange-500/15 text-orange-300';
    case 'F':
    default:
      return 'bg-muted/30 text-muted-foreground';
  }
}
