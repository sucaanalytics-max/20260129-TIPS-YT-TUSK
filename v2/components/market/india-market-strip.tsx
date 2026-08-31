import type { DemandLayerSnapshot, DspMarketMetric } from '@/lib/queries';
import { fmtInr } from '@/lib/revenue-cpm';
import { Panel, EmptyNote, SourcePill, fmtCount } from './panel';

/**
 * The paid-migration headline: is the India pie growing, and is it shifting
 * from free/ad-funded to paid?
 *
 * This is SECTOR context, not company alpha — there is no public per-catalog
 * DSP stream data, so this panel deliberately says nothing about TIPS's or
 * Saregama's share. Every figure carries its source and confidence flag.
 */

const HEADLINES: Array<{ metric: string; label: string; kind: 'count' | 'inr' | 'pct' | 'rank' }> = [
  { metric: 'paid_subscriptions', label: 'Paid subscriptions', kind: 'count' },
  { metric: 'subscription_revenue_inr', label: 'Subscription revenue', kind: 'inr' },
  { metric: 'recorded_music_revenue_inr', label: 'Recorded music revenue', kind: 'inr' },
  { metric: 'paid_share_of_streamers_pct', label: 'Paid share of streamers', kind: 'pct' },
];

function fmtMetric(m: DspMarketMetric | undefined, kind: string): string {
  if (!m) return '—';
  const v = Number(m.value);
  if (kind === 'inr') return fmtInr(v);
  if (kind === 'pct') return `${v}%`;
  if (kind === 'rank') return `#${v}`;
  return fmtCount(v);
}

export function IndiaMarketStrip({ snapshot }: { snapshot: DemandLayerSnapshot }) {
  const byMetric = new Map(snapshot.india_market.map((m) => [m.metric, m]));
  const fcByMetric = new Map(snapshot.forecasts.map((m) => [m.metric, m]));

  if (snapshot.india_market.length === 0) {
    return (
      <Panel
        title="India music-streaming market"
        subtitle="paid-migration / sector-tailwind context — not company alpha"
      >
        <EmptyNote>
          No rows in <code className="font-mono">fct_dsp_market</code>. This table is
          seeded by migration <code className="font-mono">0022_dsp_market.sql</code> — push
          migrations to populate it.
        </EmptyNote>
      </Panel>
    );
  }

  // Free-vs-paid stream split: the single sharpest statement of the thesis.
  const totalStreams = byMetric.get('total_streams');
  const paidStreams = byMetric.get('paid_streams');
  const paidStreamPct =
    totalStreams && paidStreams && Number(totalStreams.value) > 0
      ? (Number(paidStreams.value) / Number(totalStreams.value)) * 100
      : null;

  const subsHistory = snapshot.market_history['paid_subscriptions'] ?? [];

  return (
    <Panel
      title="India music-streaming market"
      subtitle="paid-migration / sector-tailwind context — not company alpha, and not bias-weighted into the IR READ"
      right={
        snapshot.asof ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            latest actual {snapshot.asof}
          </span>
        ) : null
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {HEADLINES.map((h) => {
          const m = byMetric.get(h.metric);
          const f = fcByMetric.get(h.metric);
          return (
            <div key={h.metric} className="border-border/40 rounded-md border p-3">
              <div className="text-muted-foreground text-[11px]">{h.label}</div>
              <div className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
                {fmtMetric(m, h.kind)}
              </div>
              {f ? (
                <div className="text-muted-foreground/70 text-[10px] tabular-nums">
                  {fmtMetric(f, h.kind)} by {f.asof.slice(0, 4)} (forecast)
                </div>
              ) : null}
              {m ? (
                <div className="mt-1.5">
                  <SourcePill source={m.source} url={m.source_url} confidence={m.confidence} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* Paid-subscription trajectory — the J-curve in one line. */}
        {subsHistory.length > 1 ? (
          <div className="border-border/40 rounded-md border p-3">
            <div className="text-muted-foreground text-[11px]">
              Paid-subscription trajectory
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {subsHistory.map((m, i) => (
                <span key={m.asof} className="text-foreground text-xs tabular-nums">
                  {i > 0 ? <span className="text-muted-foreground/50 mr-2">→</span> : null}
                  {fmtCount(Number(m.value))}
                  <span className="text-muted-foreground/60 ml-1 text-[10px]">
                    {m.asof.slice(0, 4)}
                  </span>
                </span>
              ))}
              {fcByMetric.get('paid_subscriptions') ? (
                <span className="text-info text-xs tabular-nums">
                  <span className="text-muted-foreground/50 mr-2">→</span>
                  {fmtCount(Number(fcByMetric.get('paid_subscriptions')!.value))}
                  <span className="opacity-70 ml-1 text-[10px]">
                    {fcByMetric.get('paid_subscriptions')!.asof.slice(0, 4)}F
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* The headroom statement: volume is free, revenue is paid. */}
        {paidStreamPct != null ? (
          <div className="border-border/40 rounded-md border p-3">
            <div className="text-muted-foreground text-[11px]">
              Paid share of streams (the monetisation gap)
            </div>
            <div className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">
              {paidStreamPct.toFixed(1)}%
            </div>
            <div className="text-muted-foreground/70 text-[10px] tabular-nums">
              {fmtCount(Number(paidStreams!.value))} paid of{' '}
              {fmtCount(Number(totalStreams!.value))} total streams · the thesis is
              monetisation MIX, not user volume
            </div>
            <div className="mt-1.5">
              <SourcePill
                source={paidStreams!.source}
                url={paidStreams!.source_url}
                confidence={paidStreams!.confidence}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
