import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getNowcastHeadline } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { Eyebrow, SectionHead } from '@/components/broadsheet';
import { EstimateColumn } from '@/components/nowcast/estimate-column';
import { TrackRecordPanel } from '@/components/nowcast/track-record';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const DAY = 86_400_000;

/**
 * Level 0 — the answer.
 *
 * One question, asked plainly, with the caveat attached to the number rather
 * than hidden in a footnote. Everything else on this site exists to justify
 * what these two columns say.
 */
export default async function NowcastPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-12 md:px-12">
      <Suspense fallback={<HeadlineSkeleton />}>
        <Headline />
      </Suspense>
    </main>
  );
}

async function Headline() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast, CACHE_TAGS.overview);

  // The cron stamps its own asof; the page reads "today" so the dateline stays
  // right even on a day the cron has not run yet.
  const asof = new Date().toISOString().slice(0, 10);
  const [tips, sare] = await Promise.all([
    getNowcastHeadline('TIPSMUSIC', asof),
    getNowcastHeadline('SAREGAMA', asof),
  ]);

  const fq = tips.fiscal;
  const daysLeft = Math.max(
    0,
    Math.round((Date.parse(`${fq.end}T00:00:00Z`) - Date.parse(`${asof}T00:00:00Z`)) / DAY),
  );

  return (
    <>
      <div className="text-muted-foreground flex flex-wrap items-baseline justify-between gap-3 py-3.5 pb-6 text-xs">
        <span className="tnum uppercase tracking-[0.04em]">
          Quarter {fq.q} · {fq.label} &nbsp;·&nbsp; {pretty(fq.start)} – {pretty(fq.end)}
        </span>
        <span className="tnum">
          {(tips.quarterProgress * 100).toFixed(0)}% elapsed &nbsp;·&nbsp;{' '}
          {daysLeft} day{daysLeft === 1 ? '' : 's'} to quarter end
        </span>
      </div>

      <div className="grid items-start gap-9 md:grid-cols-[1fr_1px_1fr]">
        <EstimateColumn head={tips} />
        <div className="bg-border hidden h-[300px] w-px md:block" />
        <EstimateColumn head={sare} />
      </div>

      <SectionHead title="Track record" note="the only reason to believe the figures above" />
      <TrackRecordPanel
        records={[
          { company: 'TIPSMUSIC', label: 'Tips Music', track: tips.trackRecord },
          { company: 'SAREGAMA', label: 'Saregama · music', track: sare.trackRecord },
        ]}
      />

      <div className="text-muted-foreground mt-10 max-w-[90ch] text-[11.5px] leading-relaxed">
        <Eyebrow className="mb-1.5">How the estimate is built</Eyebrow>
        Measured quarter-to-date reach on owned channels and Topic/OAC-attributed channels is
        extrapolated to a full quarter on elapsed days, converted at a rupee-per-thousand-views
        band, and uplifted for revenue that does not appear on YouTube. UGC reach is tracked but
        deliberately excluded: it is a cumulative discovered figure rather than a quarterly flow,
        so extrapolating it would inflate the estimate. Internal research tool — not investment
        advice.
      </div>
    </>
  );
}

function HeadlineSkeleton() {
  return (
    <div className="grid animate-pulse gap-9 py-10 md:grid-cols-2">
      <div className="bg-muted h-72" />
      <div className="bg-muted h-72" />
    </div>
  );
}
