import type { BrokerConsensusSnapshot } from '@/lib/queries';

/**
 * Side-by-side broker-consensus panel per company. Surfaces:
 *  - Buy/Hold/Sell counts + median target price
 *  - Per-broker latest call (rating + TP) with deep-link to source
 *  - Hover for methodology + notes
 *
 * Manually-curated dataset; updated as new broker reports land.
 * Notably: as of the May 2026 sweep, no Indian broker explicitly models
 * YouTube as a discrete revenue line. Our cockpit is net-additive.
 */
export function BrokerConsensusStrip({
  snapshots,
}: {
  snapshots: BrokerConsensusSnapshot[];
}) {
  const empty = snapshots.every((s) => s.consensus.n_brokers === 0);
  if (empty) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Sell-side broker consensus</h3>
        <p className="text-muted-foreground mt-2 text-xs">no broker estimates seeded yet</p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">Sell-side broker consensus</h3>
          <p className="text-muted-foreground text-xs">
            per-broker latest call · no Indian broker models YouTube as a discrete revenue line ·
            our YT cockpit is net-additive
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

function Card({ snap }: { snap: BrokerConsensusSnapshot }) {
  const { consensus, latest_estimates } = snap;
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">{snap.company}</span>
        <span className="text-muted-foreground text-[10px]">
          {consensus.n_brokers} broker{consensus.n_brokers === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        ₹{consensus.target_median ?? '—'}{' '}
        <span className="text-muted-foreground text-xs font-normal">median TP</span>
      </p>
      <p className="text-muted-foreground/80 text-[11px] tabular-nums">
        range ₹{consensus.target_low ?? '—'} – ₹{consensus.target_high ?? '—'}
      </p>
      <div className="text-muted-foreground/70 mt-1 flex gap-3 text-[10px] tabular-nums">
        <span className="text-emerald-400/80">{consensus.n_buy} buy/add</span>
        <span className="text-amber-400/70">{consensus.n_hold} hold</span>
        {consensus.n_sell > 0 ? (
          <span className="text-red-400/80">{consensus.n_sell} sell/reduce</span>
        ) : null}
      </div>
      <ul className="mt-3 space-y-1">
        {latest_estimates.map((e) => (
          <li key={e.broker_name} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-foreground truncate" title={e.notes ?? ''}>
                <span
                  className="text-muted-foreground/60 mr-1"
                  title={e.broker_type === 'institutional' ? 'Institutional' : 'Retail'}
                >
                  {e.broker_type === 'institutional' ? '◆' : '○'}
                </span>
                {e.source_url ? (
                  <a
                    href={e.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {e.broker_name}
                  </a>
                ) : (
                  e.broker_name
                )}
              </span>
              <span className="tabular-nums shrink-0 flex gap-1.5">
                <RatingBadge rating={e.rating} />
                <span className="text-foreground">₹{e.target_price_inr ?? '—'}</span>
              </span>
            </div>
            <div
              className="text-muted-foreground/60 text-[10px]"
              title={e.notes ?? undefined}
            >
              {e.asof}
              {e.methodology ? ` · ${e.methodology}` : ''}
              {e.revenue_cagr_pct ? ` · ${e.revenue_cagr_pct}% CAGR` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RatingBadge({ rating }: { rating: string }) {
  const norm = rating.toUpperCase();
  const cls =
    norm === 'BUY' || norm === 'ADD' || norm === 'ACCUMULATE'
      ? 'bg-emerald-500/15 text-emerald-300'
      : norm === 'HOLD' || norm === 'NEUTRAL'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-red-500/15 text-red-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${cls}`}>{norm}</span>
  );
}
