import { Fragment, Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getNowcastBreakdown, getNowcastHeadline } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { formatCrore } from '@/lib/financials';
import type { NowcastDrivers } from '@/lib/nowcast';
import { DriverMixChart, type DriverMixRow } from '@/components/nowcast/driver-bars';

/**
 * Level 1 — why the estimate is what it is.
 *
 * Everything here is recomputed live from today's reach rather than read back
 * from the stored nowcast row, so a reader can see which driver moved and what
 * assumption converted it into rupees. The stored row is shown beside it, and
 * when it is absent that is said plainly rather than filled in.
 */
export default async function DriversPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Drivers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Quarter-to-date reach per driver, extrapolated to a full quarter and converted at the
            rate band below. Change an assumption and the nowcast changes with it.
          </p>
        </div>
      </header>

      <Suspense fallback={<Skeleton />}>
        <Breakdown />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border-border bg-card/50 h-32 animate-pulse rounded-lg border" />
        <div className="border-border bg-card/50 h-32 animate-pulse rounded-lg border" />
      </div>
      <div className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />
      <div className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting. An absent or non-finite value is an em dash, never zero. */

function fmtViews(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-IN');
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return formatCrore(n);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

const DRIVER_KEYS = ['owned', 'topic', 'ugc'] as const;
type DriverKey = (typeof DRIVER_KEYS)[number];

const DRIVER_LABEL: Record<DriverKey, string> = {
  owned: 'Owned channels',
  topic: 'Topic / OAC attributed',
  ugc: 'UGC',
};

const DRIVER_NOTE: Record<DriverKey, string> = {
  owned: 'measured per channel, gaps imputed at each channel’s own mean',
  topic: 'third-party uploads matched to the label’s catalogue',
  ugc: 'sampled cumulative reach — a lower bound, not a quarterly flow',
};

const DRIVER_VIEWS: Record<DriverKey, keyof Pick<
  NowcastDrivers,
  'ownedViews' | 'topicViews' | 'ugcViews'
>> = {
  owned: 'ownedViews',
  topic: 'topicViews',
  ugc: 'ugcViews',
};

/* ------------------------------------------------------------------ */

async function Breakdown() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast, CACHE_TAGS.channels, CACHE_TAGS.signals);

  const asof = new Date().toISOString().slice(0, 10);
  const [tips, sare, tipsHead, sareHead] = await Promise.all([
    getNowcastBreakdown('TIPSMUSIC', asof),
    getNowcastBreakdown('SAREGAMA', asof),
    getNowcastHeadline('TIPSMUSIC', asof),
    getNowcastHeadline('SAREGAMA', asof),
  ]);

  const rows = [
    { company: 'TIPSMUSIC', label: 'Tips Music', b: tips, head: tipsHead },
    { company: 'SAREGAMA', label: 'Saregama · music', b: sare, head: sareHead },
  ];
  const a = tips.assumptions;

  const mixRows: DriverMixRow[] = rows.map((r) => ({
    company: r.company,
    label: r.label,
    contributions: r.b.result.contributions,
    mid: r.b.result.band.mid,
  }));

  return (
    <div className="space-y-10">
      {/* ---- Recomputed band, per company ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Recomputed band — this quarter, as of {asof}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => {
            const stored = r.head.band;
            return (
              <div key={r.company} className="border-border bg-card rounded-lg border p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                  {r.label} · {r.b.fiscal.label}
                </p>
                <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
                  {fmtMoney(r.b.result.band.mid)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                  band {fmtMoney(r.b.result.band.low)} – {fmtMoney(r.b.result.band.high)} ·{' '}
                  {fmtPct(r.b.result.quarterProgress * 100, 0)} of the quarter elapsed
                </p>
                {stored ? (
                  <p className="text-muted-foreground mt-2 text-xs tabular-nums">
                    stored estimate {fmtMoney(stored.mid)} as of {stored.asof}
                  </p>
                ) : (
                  <p className="text-warning mt-2 text-xs">
                    ⚠ no estimate stored yet — the daily cron has not written a row for{' '}
                    {r.b.fiscal.label}. The figure above is recomputed here, not read back.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Driver breakdown ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Driver breakdown — where the midpoint comes from
        </h2>
        <div className="border-border bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3 text-right">Views, quarter to date</th>
                <th className="px-4 py-3 text-right">Projected full quarter</th>
                <th className="px-4 py-3 text-right">Contribution</th>
                <th className="px-4 py-3 text-right">Share of midpoint</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.b.result.quarterProgress;
                const byDriver = new Map(r.b.result.contributions.map((c) => [c.driver, c]));
                const countedQtd =
                  r.b.drivers.ownedViews +
                  r.b.drivers.topicViews +
                  (a.includeUgc ? r.b.drivers.ugcViews : 0);

                return (
                  <Fragment key={r.company}>
                    {DRIVER_KEYS.map((d, i) => {
                      const qtd = r.b.drivers[DRIVER_VIEWS[d]];
                      const counted = d !== 'ugc' || a.includeUgc;
                      const c = byDriver.get(d);
                      const projected = counted && p > 0 ? qtd / p : null;
                      return (
                        <tr
                          key={d}
                          className="border-border/40 hover:bg-muted/30 border-b last:border-0"
                        >
                          {i === 0 ? (
                            <td
                              rowSpan={DRIVER_KEYS.length + 1}
                              className="border-border/40 border-r px-4 py-2.5 align-top font-medium"
                            >
                              {r.label}
                              <span className="text-muted-foreground mt-1 block text-xs font-normal">
                                {r.b.fiscal.label}
                              </span>
                            </td>
                          ) : null}
                          <td className="px-4 py-2.5">
                            {DRIVER_LABEL[d]}
                            <span className="text-muted-foreground mt-0.5 block text-xs">
                              {DRIVER_NOTE[d]}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtViews(qtd)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {counted ? (
                              fmtViews(projected)
                            ) : (
                              <span className="text-muted-foreground">not projected</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {counted ? (
                              fmtMoney(c?.mid)
                            ) : (
                              <span className="text-warning">⚠ excluded</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {/* pctOfMid is ALREADY 0-100 (nowcast.ts computes
                                (mid / band.mid) * 100). Multiplying again once
                                shipped "7143%". */}
                            {counted ? (
                              fmtPct(c?.pctOfMid)
                            ) : (
                              <span className="text-warning">⚠ excluded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-border/40 hover:bg-muted/30 border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium">Counted total</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtViews(countedQtd)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtViews(r.b.result.projectedViews)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {fmtMoney(r.b.result.band.mid)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {r.b.result.band.mid > 0 ? '100.0%' : '—'}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-3 max-w-[90ch] text-xs leading-relaxed">
          Contribution is the driver&rsquo;s projected full-quarter views priced at the midpoint
          rate and grossed up for revenue that never appears on YouTube. It is a component of an
          estimate, not a measured receipt.
        </p>
      </section>

      {/* ---- Driver mix chart ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Driver mix — the two companies side by side
        </h2>
        <DriverMixChart rows={mixRows} ugcIncluded={a.includeUgc} />
      </section>

      {/* ---- Reach measured ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Reach measured this quarter
        </h2>
        <p className="text-muted-foreground mb-3 text-xs">
          The input, before any assumption is applied. &ldquo;Days observed&rdquo; is how much of
          the elapsed quarter actually reported; the owned leg is imputed to full coverage, which
          is why it is not a whole number before rounding.
        </p>
        <div className="border-border bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Quarter</th>
                <th className="px-4 py-3 text-right">Days observed</th>
                <th className="px-4 py-3 text-right">Owned views</th>
                <th className="px-4 py-3 text-right">Topic / OAC attributed</th>
                <th className="px-4 py-3 text-right">
                  UGC {a.includeUgc ? '(included)' : '(excluded)'}
                </th>
                <th className="px-4 py-3 text-right">Projected full quarter</th>
                <th className="px-4 py-3 text-right">Midpoint estimate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { observedDays, elapsedDays } = r.b.drivers;
                return (
                  <tr
                    key={r.company}
                    className="border-border/40 hover:bg-muted/30 border-b last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">{r.label}</td>
                    <td className="text-muted-foreground px-4 py-2.5">
                      {r.b.fiscal.label} · {fmtPct(r.b.result.quarterProgress * 100, 0)} elapsed
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {observedDays != null && elapsedDays != null
                        ? `${observedDays} / ${elapsedDays}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtViews(r.b.drivers.ownedViews)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtViews(r.b.drivers.topicViews)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="text-muted-foreground">
                        {fmtViews(r.b.drivers.ugcViews)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtViews(r.b.result.projectedViews)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {fmtMoney(r.b.result.band.mid)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Sense check ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Sense check — not a score
        </h2>
        <p className="text-muted-foreground mb-3 max-w-[90ch] text-xs leading-relaxed">
          This quarter&rsquo;s midpoint set beside the last quarter that actually printed. It is
          not an accuracy measure: the two are different quarters, and a real score only exists
          once this one closes and is reported. Nothing here is coloured good or bad, because
          nothing here has been scored. It is present to catch an estimate that has gone obviously
          wrong, and to keep the model&rsquo;s known bias visible rather than buried.
        </p>
        <div className="border-border bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3 text-right">Midpoint, this quarter</th>
                <th className="px-4 py-3">Last printed</th>
                <th className="px-4 py-3 text-right">Ratio</th>
                <th className="px-4 py-3">Reads</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const printed = r.head.lastPrinted;
                const ratio =
                  printed && printed.valueInr > 0 ? r.b.result.band.mid / printed.valueInr : null;
                const reads =
                  ratio === null
                    ? '—'
                    : ratio < 0.85
                      ? 'below the printed quarter'
                      : ratio > 1.15
                        ? 'above the printed quarter'
                        : 'close to the printed quarter';
                return (
                  <tr
                    key={r.company}
                    className="border-border/40 hover:bg-muted/30 border-b last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">{r.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtMoney(r.b.result.band.mid)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {printed ? (
                        <>
                          {fmtMoney(printed.valueInr)}{' '}
                          <span className="text-muted-foreground">· {printed.fiscalLabel}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {ratio === null ? '—' : fmtPct(ratio * 100, 0)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5">{reads}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-3 max-w-[90ch] text-xs leading-relaxed">
          Saregama reads low against its printed quarter and Tips does not. That is expected and
          has deliberately <em>not</em> been corrected: the non-YouTube uplift below is a single
          flat multiplier applied to both, while Saregama&rsquo;s music segment carries far more
          licensing revenue that never appears on YouTube than Tips&rsquo; single segment does.
          Fitting the uplift per company to the handful of figures already known would make the
          track record flattering and meaningless before it has scored a single quarter.
        </p>
      </section>

      {/* ---- Assumptions ---- */}
      <section>
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Assumptions — every one of these is arguable
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Assumption
            label="Rate band"
            value={`₹${a.cpmLow}–${a.cpmHigh}`}
            unit=" per 1,000 views"
            note={`Midpoint ₹${a.cpmMid}. The band width is the honest uncertainty on realised rate, not a confidence interval.`}
            cost="If the true rate sits outside the band, every figure on this page is out by the same proportion — the mix is unaffected, the level is not."
          />
          <Assumption
            label="Non-YouTube uplift"
            value={`${a.nonYouTubeUplift}×`}
            note="Revenue that does not appear on YouTube at all — audio DSPs, sync, publishing."
            cost="The single largest source of error. One flat multiplier for two very different catalogues is why Saregama reads low in the sense check above."
          />
          <Assumption
            label="UGC"
            value={a.includeUgc ? 'Included' : 'Excluded'}
            note="UGC reach is a cumulative discovered figure, not a quarterly flow."
            cost="Including it would extrapolate a cumulative total by elapsed days and inflate the estimate by roughly 1/progress — early in a quarter, several times over."
          />
          <Assumption
            label="Extrapolation"
            value="Linear on elapsed days"
            note="Assumes the rest of the quarter looks like the part already measured."
            cost="A release-heavy end to the quarter reads low; a front-loaded one reads high. The error shrinks as the quarter fills."
          />
        </div>
      </section>
    </div>
  );
}

function Assumption({
  label,
  value,
  unit,
  note,
  cost,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  cost: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="text-foreground mt-2 text-xl font-semibold tabular-nums">
        {value}
        {unit ? <span className="text-muted-foreground text-xs font-normal">{unit}</span> : null}
      </p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{note}</p>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        <span className="text-warning font-medium">If wrong: </span>
        {cost}
      </p>
    </div>
  );
}
