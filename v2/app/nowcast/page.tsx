import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getNowcastHeadline, getReportedFinancials } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { NowcastKpiStrip } from '@/components/nowcast/estimate-column';
import { ReportedFinancialsTable, TrackRecordPanel } from '@/components/nowcast/track-record';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Level 0 — the answer.
 *
 * One question: what will the music line print this quarter. The estimate, the
 * filed figures it is scored against, and the score itself, in that order, so
 * the caveat is never further away than the number it qualifies.
 */
export default async function NowcastPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Revenue nowcast</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            What the music line prints this quarter — TIPSMUSIC + SAREGAMA, from measured
            quarter-to-date reach.
          </p>
        </div>
        <Suspense fallback={<span className="text-muted-foreground text-xs">reading quarter…</span>}>
          <Dateline />
        </Suspense>
      </header>

      <Suspense fallback={<KpiSkeleton />}>
        <Headline />
      </Suspense>

      <section className="mt-10">
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Reported financials — what has actually been filed
        </h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Read off the BSE filings in rupees (the filings quote lakhs). These are the actuals the
          estimate is scored against; only rows marked confirmed feed the headline or the track
          record.
        </p>
        <Suspense fallback={<TableSkeleton />}>
          <Reported />
        </Suspense>
      </section>

      <section className="mt-10">
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Track record — how the estimate has scored
        </h2>
        <Suspense fallback={<CardSkeleton />}>
          <Score />
        </Suspense>
      </section>

      <p className="text-muted-foreground mt-10 max-w-[90ch] text-xs leading-relaxed">
        <span className="text-foreground font-medium">How the estimate is built.</span>{' '}
        Measured quarter-to-date reach on owned channels and Topic/OAC-attributed channels is
        extrapolated to a full quarter on elapsed days, converted at a rupee-per-thousand-views
        band, and uplifted for revenue that does not appear on YouTube. UGC reach is tracked but
        deliberately excluded: it is a cumulative discovered figure rather than a quarterly flow,
        so extrapolating it would inflate the estimate. Internal research tool — not investment
        advice.
      </p>
    </main>
  );
}

/**
 * One cached read behind all three boundaries.
 *
 * The dateline, the KPI strip and the track record are three Suspense
 * boundaries but one query: sharing a single cache entry keeps them from
 * disagreeing about the quarter, and from hitting the database three times for
 * the same rows. The cron stamps its own asof; the page reads "today" so the
 * dateline stays right even on a day the cron has not run yet.
 */
async function nowcast() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast, CACHE_TAGS.overview);

  const asof = new Date().toISOString().slice(0, 10);
  const [tips, sare] = await Promise.all([
    getNowcastHeadline('TIPSMUSIC', asof),
    getNowcastHeadline('SAREGAMA', asof),
  ]);
  return { asof, tips, sare };
}

async function Dateline() {
  const { tips } = await nowcast();
  const fiscal = tips.fiscal;
  return (
    <p className="text-muted-foreground text-xs uppercase tracking-wider tabular-nums">
      {fiscal.label} · {pretty(fiscal.start)} – {pretty(fiscal.end)}
    </p>
  );
}

async function Headline() {
  const { asof, tips, sare } = await nowcast();
  return <NowcastKpiStrip heads={[tips, sare]} asof={asof} />;
}

async function Reported() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast);
  const rows = await getReportedFinancials();
  return <ReportedFinancialsTable rows={rows} />;
}

async function Score() {
  const { tips, sare } = await nowcast();
  return (
    <TrackRecordPanel
      records={[
        { company: 'TIPSMUSIC', label: 'Tips Music', track: tips.trackRecord },
        { company: 'SAREGAMA', label: 'Saregama · music', track: sare.trackRecord },
      ]}
    />
  );
}

function KpiSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((__, j) => (
            <div key={j} className="border-border bg-card/50 h-28 animate-pulse rounded-lg border" />
          ))}
        </div>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return <div className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />;
}

function CardSkeleton() {
  return <div className="border-border bg-card/50 h-32 animate-pulse rounded-lg border" />;
}
