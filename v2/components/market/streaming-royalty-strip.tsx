import type { StreamingRoyaltyEstimate } from '@/lib/queries';
import { fmtInr } from '@/lib/revenue-cpm';
import { ConfidenceBadge } from '@/components/signals/confidence-badge';
import { Panel, EmptyNote, fmtCount } from './panel';

/**
 * Top-down sizing of the audio-DSP "music licensing" royalty — the dominant
 * label revenue line that the YouTube layers capture NONE of.
 *
 * This is the only per-company number on /market, and deliberately the weakest:
 * it takes the sector pool and multiplies by an ASSUMED catalog share, because
 * no public per-catalog DSP stream data exists. Capped at grade D by
 * construction, and kept here beside the sector layer it derives from rather
 * than on /signals next to the measured YouTube bands.
 *
 * When the estimate fails reconciliation against the recorded-music pool
 * (see computeRoyaltyCrossCheck), this component renders the FAILURE — it never
 * renders a headline band it knows to be inconsistent. A grade badge is not
 * sufficient protection for a number that is an order of magnitude out; on an
 * IR surface someone will read the big figure and not the small letter.
 */
export function StreamingRoyaltyStrip({
  estimates,
}: {
  estimates: StreamingRoyaltyEstimate[];
}) {
  const seeded = estimates.some((e) => e.inputs.subscription_revenue_inr != null);
  if (!seeded) {
    return (
      <Panel
        title="Implied audio-DSP royalty (directional)"
        subtitle="the music-licensing line the YouTube model does not capture"
      >
        <EmptyNote>
          Needs India market rows in <code className="font-mono">fct_dsp_market</code>{' '}
          (migration <code className="font-mono">0022_dsp_market.sql</code>) before it can
          size anything.
        </EmptyNote>
      </Panel>
    );
  }

  const blocked = estimates.filter((e) => !e.cross_check.passed);

  return (
    <Panel
      title="Implied audio-DSP royalty (directional)"
      subtitle="sector pool × ASSUMED catalog share — capped at grade D by construction, never company alpha"
      right={
        estimates[0]?.inputs.asof ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            inputs as of {estimates[0].inputs.asof}
          </span>
        ) : null
      }
    >
      {blocked.length > 0 ? <InputConflictBanner est={blocked[0]} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {estimates.map((e) =>
          e.cross_check.passed ? (
            <Card key={e.company} est={e} />
          ) : (
            <BlockedCard key={e.company} est={e} />
          ),
        )}
      </div>

      <p className="text-muted-foreground/70 mt-3 text-[11px]">
        ⚠️ The catalog-share assumption is a placeholder, not a disclosure — it is the
        single largest source of error here, and the band scales linearly with it. Use this
        to sanity-check a broker&apos;s music-licensing segment, never as an estimate in its
        own right. Replace the assumption with disclosed music-licensing revenue ÷ IFPI
        India recorded-music revenue as soon as a filing allows.
      </p>
    </Panel>
  );
}

/** One shared explanation of the input conflict — it is sector-wide, not per-company. */
function InputConflictBanner({ est }: { est: StreamingRoyaltyEstimate }) {
  const cc = est.cross_check;
  return (
    <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3">
      <p className="text-red-200 text-xs font-medium">
        Estimate suppressed — the source inputs contradict each other
      </p>
      <ul className="text-red-200/80 mt-1.5 space-y-1 text-[11px]">
        {cc.failures.map((f) => (
          <li key={f}>• {f}</li>
        ))}
      </ul>
      <p className="text-red-200/70 mt-2 text-[11px]">
        The ₹0.10/stream min-guarantee rate (2024 broker notes) and the ~6tn India stream
        count (EY-FICCI) are not on the same basis, so multiplying them overstates the
        free-tier leg — which then contributes ~99% of the modelled royalty. Fix the
        per-stream input, or derive the free leg from the recorded-music pool net of the
        YouTube revenue already modelled on <span className="font-mono">/signals</span>,
        before trusting a band here.
      </p>
    </div>
  );
}

function BlockedCard({ est }: { est: StreamingRoyaltyEstimate }) {
  const cc = est.cross_check;
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">
          {est.company}
        </span>
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-mono text-red-300">
          unreconciled
        </span>
      </div>

      <p className="text-muted-foreground mt-1 text-sm">
        No band shown
        <span className="text-muted-foreground/60 text-[11px]"> — inputs inconsistent</span>
      </p>

      <dl className="mt-2 space-y-0.5 text-[10px]">
        <Line
          k={`Ceiling at ${(est.assumed_catalog_share * 100).toFixed(1)}% share`}
          v={cc.ceiling_inr != null ? `${fmtInr(cc.ceiling_inr)}/yr` : '—'}
        />
        <Line
          k="Model output (rejected)"
          v={`${fmtInr(cc.implied_annual_inr)}/yr`}
          warn
        />
        <Line
          k="Overshoot vs ceiling"
          v={cc.ceiling_ratio != null ? `${cc.ceiling_ratio.toFixed(1)}×` : '—'}
          warn
        />
        <Line
          k="Implied share of India market"
          v={
            cc.implied_share_of_market != null
              ? `${(cc.implied_share_of_market * 100).toFixed(0)}%`
              : '—'
          }
          warn
        />
      </dl>
      <p className="text-muted-foreground/60 mt-2 text-[10px]">
        Ceiling = assumed catalog share × total India recorded-music revenue. It is an
        upper bound on ALL recorded music (YouTube included), not an estimate.
      </p>
    </div>
  );
}

function Card({ est }: { est: StreamingRoyaltyEstimate }) {
  const q = est.estimate.quarterly;
  const cc = est.cross_check;
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-foreground text-xs font-semibold tracking-tight">
          {est.company}
        </span>
        <ConfidenceBadge estimate={est.estimate} />
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {fmtInr(q.low_inr)} – {fmtInr(q.high_inr)}
        <span className="text-muted-foreground text-xs font-normal"> /quarter</span>
      </p>
      <p className="text-muted-foreground/80 text-[11px] tabular-nums">
        annualised {fmtInr(q.low_inr * 4)} – {fmtInr(q.high_inr * 4)}
      </p>
      <dl className="mt-2 space-y-0.5 text-[10px]">
        <Line
          k="Assumed catalog share"
          v={`${(est.assumed_catalog_share * 100).toFixed(1)}%`}
          warn
        />
        <Line
          k="India subscription pool"
          v={
            est.inputs.subscription_revenue_inr != null
              ? fmtInr(est.inputs.subscription_revenue_inr)
              : '—'
          }
        />
        <Line
          k="Ad-funded streams"
          v={est.inputs.ad_streams != null ? fmtCount(est.inputs.ad_streams) : '—'}
        />
        <Line
          k="Share of India recorded music"
          v={
            cc.implied_share_of_market != null
              ? `${(cc.implied_share_of_market * 100).toFixed(1)}%`
              : 'unreconciled'
          }
        />
        {est.inputs.source ? <Line k="Source" v={est.inputs.source} /> : null}
      </dl>
    </div>
  );
}

function Line({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground/70">{k}</dt>
      <dd className={`tabular-nums ${warn ? 'text-amber-300' : 'text-muted-foreground'}`}>{v}</dd>
    </div>
  );
}
