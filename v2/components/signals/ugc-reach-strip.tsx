import type { UGCReachSnapshot } from '@/lib/queries';

/**
 * Side-by-side UGC reach panel per company. Surfaces:
 *  - Total attributed UGC view volume (latest snapshot)
 *  - Number of UGC Shorts discovered
 *  - WoW delta in attributed views once ≥ 2 snapshots exist
 *  - Top 5 anchor tracks driving UGC reach
 *
 * Source: free Shorts pivot scrape (~15 Shorts visible per anchor sound).
 * Underestimates true UGC volume by the truncation factor — use as a
 * directional trend signal, not absolute revenue measurement.
 */
export function UGCReachStrip({ snapshots }: { snapshots: UGCReachSnapshot[] }) {
  const empty = snapshots.every((s) => s.attributed_views === 0);
  if (empty) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">UGC catalog reach (Shorts)</h3>
        <p className="text-muted-foreground mt-2 text-xs">
          no UGC snapshots yet — first weekly cron run pending
        </p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">UGC catalog reach (Shorts)</h3>
          <p className="text-muted-foreground text-xs">
            attributed views from top-25 catalog anchors per label · ~15 visible Shorts per sound (YT truncation)
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

function Card({ snap }: { snap: UGCReachSnapshot }) {
  const wow = snap.weekOverWeek;
  const wowColor =
    wow == null
      ? 'text-muted-foreground'
      : wow.delta_views > 0
        ? 'text-emerald-400'
        : wow.delta_views < 0
          ? 'text-red-400'
          : 'text-muted-foreground';
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">{snap.company}</span>
        <span className="text-muted-foreground text-[10px]">
          asof {snap.latestAsof ?? '—'} · {snap.snapshotsAvailable} snapshot
          {snap.snapshotsAvailable === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {fmtBig(snap.attributed_views)} <span className="text-muted-foreground text-xs font-normal">attributed views</span>
      </p>
      <p className="text-muted-foreground text-[11px] tabular-nums">
        {snap.ugc_shorts_count} UGC Shorts across {snap.topAnchors.length} anchor
        {snap.topAnchors.length === 1 ? '' : 's'}
        {snap.ugc_shorts_count > 0
          ? ` · avg ${fmtBig(Math.round(snap.attributed_views / snap.ugc_shorts_count))}/Short`
          : ''}
      </p>
      <p className={`mt-0.5 text-xs tabular-nums ${wowColor}`}>
        {wow == null
          ? 'awaiting 2nd snapshot for WoW delta'
          : wow.delta_views > 0
            ? `▲ +${fmtBig(wow.delta_views)} (${fmtPct(wow.pct)}) WoW`
            : wow.delta_views < 0
              ? `▼ ${fmtBig(wow.delta_views)} (${fmtPct(wow.pct)}) WoW`
              : 'flat WoW'}
      </p>
      <ul className="mt-3 space-y-1.5">
        {snap.topAnchors.map((a) => (
          <li key={a.source_video_id} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-foreground truncate" title={a.source_title}>
                {a.source_title.length > 48 ? a.source_title.slice(0, 48) + '…' : a.source_title}
              </span>
              <span className="text-muted-foreground tabular-nums shrink-0">
                {fmtBig(a.ugc_views_sum)}
              </span>
            </div>
            <div className="text-muted-foreground/70 text-[10px] tabular-nums">
              {a.ugc_count} Shorts · top:{' '}
              <a
                href={`https://www.youtube.com/shorts/${a.top_ugc_id}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {fmtBig(a.top_ugc_views)} views
              </a>
              {a.top_ugc_channel ? (
                <span className="text-muted-foreground/60 ml-1">
                  · @{a.top_ugc_channel.slice(0, 22)}
                  {a.top_ugc_channel.length > 22 ? '…' : ''}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <AttributionBadge counts={snap.attributionCounts} catalogMatches={snap.catalogMatchCount} />
    </div>
  );
}

function AttributionBadge({
  counts,
  catalogMatches,
}: {
  counts: Record<string, number>;
  catalogMatches: number;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <p className="text-muted-foreground/60 mt-3 text-[10px]">
        attribution: not yet sampled
      </p>
    );
  }
  const cid = counts['content_id'] ?? 0;
  const sound = counts['sound_ref'] ?? 0;
  const none = counts['none'] ?? 0;
  const pctCid = total > 0 ? Math.round((cid / total) * 100) : 0;
  return (
    <div className="mt-3 space-y-0.5 text-[10px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground/70">attribution (n={total}):</span>
        <span className="text-emerald-400/90 tabular-nums" title="Content ID claim detected on watch page">
          {pctCid}% Content ID
        </span>
        <span className="text-muted-foreground/50 tabular-nums" title="Shorts sound-system reference">
          {sound} sound-ref
        </span>
        {none > 0 ? (
          <span className="text-muted-foreground/50 tabular-nums" title="No detected attribution panel">
            {none} unattributed
          </span>
        ) : null}
      </div>
      <div className="text-muted-foreground/60">
        <span
          className={catalogMatches > 0 ? 'text-emerald-400/80' : 'text-muted-foreground/60'}
          title="UGC where the master audio source resolves to our owned or topic channels — strict confirm that this label earns Content ID share"
        >
          {catalogMatches} of {total} match OUR catalog
        </span>
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
