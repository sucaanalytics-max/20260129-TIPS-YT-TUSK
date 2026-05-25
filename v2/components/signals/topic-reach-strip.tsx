import { Sparkline } from '@/components/charts/sparkline';
import type { TopicReachSnapshot } from '@/lib/queries';
import { fmtInr } from '@/lib/revenue-cpm';
import { ConfidenceBadge } from './confidence-badge';

/**
 * Side-by-side catalog-reach panel per company. Surfaces:
 *  - Daily attributed views (sparkline of last ~60 days)
 *  - Rolling 1d / 7d / 30d totals
 *  - WoW delta (last-7d vs prior-7d)
 *  - Top contributing Topic / OAC channels with their catalog_share weight
 *
 * Computation: each Topic/OAC channel's daily_views × dim_artist_label
 * catalog_share for this company. Sums across channels for company-level
 * attributed reach. See lib/queries.ts:getTopicReach.
 */
export function TopicReachStrip({ snapshots }: { snapshots: TopicReachSnapshot[] }) {
  const empty = snapshots.every((s) => s.daysAvailable === 0);
  if (empty) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Catalog reach (Topic + OAC channels)</h3>
        <p className="text-muted-foreground mt-2 text-xs">
          no Topic-channel data yet — first daily cron run pending
        </p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            Catalog reach (Topic + OAC channels)
          </h3>
          <p className="text-muted-foreground text-xs">
            non-owned artist channels attributed by{' '}
            <code className="bg-muted/30 rounded px-1 text-[10px]">catalog_share</code> · captures
            the second revenue leg beyond label-owned channels
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

function Card({ snap }: { snap: TopicReachSnapshot }) {
  const wow = snap.weekOverWeek;
  const wowColor =
    wow == null
      ? 'text-muted-foreground'
      : wow.delta_views > 0
        ? 'text-emerald-400'
        : wow.delta_views < 0
          ? 'text-red-400'
          : 'text-muted-foreground';
  const sparkValues = snap.series.map((p) => p.attributed_daily_views);
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">{snap.company}</span>
        <span className="text-muted-foreground text-[10px]">
          {snap.channelsTracked} channel{snap.channelsTracked === 1 ? '' : 's'} ·{' '}
          {snap.daysAvailable}d data
        </span>
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {fmtBig(snap.totals.last_7d)}{' '}
        <span className="text-muted-foreground text-xs font-normal">7-day attributed views</span>
      </p>
      <p className={`text-xs tabular-nums ${wowColor}`}>
        {wow == null
          ? '— (need ≥14 days for WoW)'
          : wow.delta_views > 0
            ? `▲ +${fmtBig(wow.delta_views)} (${fmtPct(wow.pct)}) vs prior 7d`
            : wow.delta_views < 0
              ? `▼ ${fmtBig(wow.delta_views)} (${fmtPct(wow.pct)}) vs prior 7d`
              : 'flat vs prior 7d'}
      </p>
      <div className="text-muted-foreground/70 mt-1 flex gap-3 text-[10px] tabular-nums">
        <span>today: {fmtBig(snap.totals.last_1d)}</span>
        <span>30d: {fmtBig(snap.totals.last_30d)}</span>
      </div>
      <div
        className="text-muted-foreground/80 mt-1.5 flex flex-wrap items-center gap-2 text-[11px] tabular-nums"
        title={snap.revenueEstimate.methodology}
      >
        <span className="text-amber-400/80">≈ {fmtInr(snap.revenueEstimate.weekly.low_inr)} – {fmtInr(snap.revenueEstimate.weekly.high_inr)}/wk</span>
        <ConfidenceBadge estimate={snap.revenueEstimate} />
        <span className="text-muted-foreground/50">
          (Q-rate {fmtInr(snap.revenueEstimate.quarterly.low_inr)} – {fmtInr(snap.revenueEstimate.quarterly.high_inr)})
        </span>
      </div>
      {sparkValues.length > 1 ? (
        <div className="mt-2">
          <Sparkline
            values={sparkValues.length ? sparkValues : [null]}
            width={240}
            height={36}
            color={snap.company === 'TIPSMUSIC' ? '#60a5fa' : '#a78bfa'}
          />
        </div>
      ) : null}
      <div className="mt-3">
        <p className="text-muted-foreground/70 mb-1 text-[10px] uppercase tracking-wider">
          top contributors (7d)
        </p>
        <ul className="space-y-1">
          {snap.topContributors.map((c) => (
            <li key={c.channel_id} className="text-[11px]">
              <div className="flex items-baseline justify-between gap-2">
                <a
                  href={`https://www.youtube.com/channel/${c.channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground truncate underline-offset-2 hover:underline"
                  title={c.channel_name}
                >
                  <span
                    className={c.kind === 'oac' ? 'text-emerald-400/70' : 'text-amber-400/70'}
                    title={c.kind === 'oac' ? 'Official Artist Channel' : 'Auto-generated Topic'}
                  >
                    {c.kind === 'oac' ? '◆' : '○'}
                  </span>{' '}
                  {c.channel_name.length > 32
                    ? c.channel_name.slice(0, 32) + '…'
                    : c.channel_name}
                </a>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {fmtBig(c.last_7d_attributed_views)}
                </span>
              </div>
              <div className="text-muted-foreground/60 text-[10px] tabular-nums">
                share {(c.catalog_share * 100).toFixed(0)}% · raw 7d {fmtBig(c.last_7d_raw_views)}
                {c.latest_subscribers != null ? ` · ${fmtBig(c.latest_subscribers)} subs` : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function fmtBig(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtPct(p: number): string {
  return `${p > 0 ? '+' : ''}${(p * 100).toFixed(0)}%`;
}
