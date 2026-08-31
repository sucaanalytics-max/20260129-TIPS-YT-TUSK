import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getNowcastBreakdown, getNowcastHeadline } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { formatCrore } from '@/lib/financials';
import { Eyebrow, PageHead, SectionHead, Sheet, Td, Th } from '@/components/broadsheet';
import { DriverBars } from '@/components/nowcast/driver-bars';

/**
 * Level 1 — why the estimate is what it is.
 *
 * This page shows the working, recomputed live from today's reach rather than
 * read back from the stored row, so a reader can see which driver moved and
 * what assumption converted it into rupees.
 */
export default async function DriversPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-12 pt-8 md:px-12">
      <PageHead
        title="Drivers"
        kicker="Level 1 · why it moved"
        standfirst="Quarter-to-date reach, extrapolated to a full quarter and converted at the rate band below. Change an assumption and the estimate on the front page changes with it."
      />
      <Suspense fallback={<div className="bg-muted h-96 animate-pulse" />}>
        <Breakdown />
      </Suspense>
    </main>
  );
}

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
    { label: 'Tips Music', b: tips, head: tipsHead },
    { label: 'Saregama · music', b: sare, head: sareHead },
  ];
  const a = tips.assumptions;

  return (
    <>
      <div className="grid gap-10 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="font-serif text-[15px] font-semibold tracking-[0.02em]">{r.label}</div>
            <div className="text-muted-foreground mt-0.5 text-[11.5px]">
              {r.b.fiscal.label} to date · {(r.b.result.quarterProgress * 100).toFixed(0)}% elapsed
            </div>
            <DriverBars
              contributions={r.b.result.contributions}
              drivers={r.b.drivers}
              mid={r.b.result.band.mid}
            />
          </div>
        ))}
      </div>

      <SectionHead title="Reach measured this quarter" note="the input, before any assumption is applied" />
      <Sheet className="mt-5">
        <thead>
          <tr>
            <Th left>Company</Th>
            <Th>Owned views</Th>
            <Th>Topic / OAC attributed</Th>
            <Th>UGC (excluded)</Th>
            <Th>Projected full quarter</Th>
            <Th>Midpoint estimate</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <Td left>{r.label}</Td>
              <Td>{Math.round(r.b.drivers.ownedViews).toLocaleString('en-IN')}</Td>
              <Td>{Math.round(r.b.drivers.topicViews).toLocaleString('en-IN')}</Td>
              <Td className="text-muted-foreground">not counted</Td>
              <Td>{Math.round(r.b.result.projectedViews).toLocaleString('en-IN')}</Td>
              <Td>{formatCrore(r.b.result.band.mid)}</Td>
            </tr>
          ))}
        </tbody>
      </Sheet>

      <SectionHead
        title="Sense check"
        note="not a score — the quarter has not closed"
      />
      <p className="text-muted-foreground mt-3 max-w-[90ch] text-[12px] leading-relaxed">
        This quarter&rsquo;s midpoint set beside the last quarter that actually printed. It is not
        an accuracy measure: the two are different quarters, and a real score only exists once
        this one closes and is reported. It is here to catch an estimate that has gone obviously
        wrong, and to make the model&rsquo;s known bias visible rather than buried.
      </p>
      <Sheet className="mt-4">
        <thead>
          <tr>
            <Th left>Company</Th>
            <Th>Midpoint, this quarter</Th>
            <Th>Last printed</Th>
            <Th>Ratio</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const printed = r.head.lastPrinted?.valueInr ?? null;
            const ratio = printed && printed > 0 ? r.b.result.band.mid / printed : null;
            return (
              <tr key={r.label}>
                <Td left>{r.label}</Td>
                <Td>{formatCrore(r.b.result.band.mid)}</Td>
                <Td>
                  {r.head.lastPrinted
                    ? `${formatCrore(r.head.lastPrinted.valueInr)} · ${r.head.lastPrinted.fiscalLabel}`
                    : '—'}
                </Td>
                <Td>{ratio === null ? '—' : `${(ratio * 100).toFixed(0)}%`}</Td>
              </tr>
            );
          })}
        </tbody>
      </Sheet>
      <p className="text-muted-foreground mt-3 max-w-[90ch] text-[11.5px] leading-relaxed">
        Saregama reads low against its printed quarter and Tips does not. That is expected and has
        deliberately <em>not</em> been corrected: the non-YouTube uplift below is a single flat
        multiplier applied to both, while Saregama&rsquo;s music segment carries far more licensing
        revenue that never appears on YouTube than Tips&rsquo; single segment does. Fitting the
        uplift per company to the handful of figures already known would make the track record
        flattering and meaningless before it has scored a single quarter.
      </p>

      <SectionHead title="Assumptions" note="every one of these is arguable — that is the point" />
      <div className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <Assumption
          label="Rate band"
          value={`₹${a.cpmLow}–${a.cpmHigh}`}
          unit=" per 1,000 views"
          note={`Midpoint ₹${a.cpmMid}. The band width is the honest uncertainty on realised rate, not a confidence interval.`}
        />
        <Assumption
          label="Non-YouTube uplift"
          value={`${a.nonYouTubeUplift}×`}
          note="Revenue that does not appear on YouTube at all — audio DSPs, sync, publishing. The single largest source of error in the estimate."
        />
        <Assumption
          label="UGC"
          value={a.includeUgc ? 'Included' : 'Excluded'}
          note="UGC reach is a cumulative discovered figure, not a quarterly flow. Extrapolating it by elapsed days would inflate the estimate by roughly 1/progress."
        />
        <Assumption
          label="Extrapolation"
          value="Linear on elapsed days"
          note="Assumes the rest of the quarter looks like the part measured. A release-heavy month at the end will read low."
        />
      </div>
    </>
  );
}

function Assumption({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div className="border-border border-t pt-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 font-serif text-xl font-semibold">
        {value}
        {unit ? <span className="text-muted-foreground text-xs font-normal">{unit}</span> : null}
      </div>
      <p className="text-muted-foreground mt-2 text-[11.5px] leading-relaxed">{note}</p>
    </div>
  );
}
