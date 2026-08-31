import Link from 'next/link';
import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getFreshness } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { FreshnessBadge } from '@/components/freshness-badge';
import { Eyebrow, PageHead } from '@/components/broadsheet';

/**
 * Level 2 — the raw series.
 *
 * An index rather than a dashboard. These pages are where a number gets
 * checked, and each is listed with the question it actually answers, so
 * nobody has to open four of them to find the one they wanted.
 */
const SURFACES = [
  {
    href: '/explore',
    title: 'Explore',
    answers: 'Slice the daily grain yourself — company, metric, grain and range, with the filters exposed rather than chosen for you.',
  },
  {
    href: '/analysis',
    title: 'Control charts',
    answers: 'Is today’s move outside the range this series normally occupies, or does it only feel large?',
  },
  {
    href: '/growth',
    title: 'Periods',
    answers: 'This quarter against last, against the same quarter a year ago. Note the 16 Feb 2026 measurement break.',
  },
  {
    href: '/channels',
    title: 'Channels',
    answers: 'Which of the 38 owned channels carries the catalogue, and which are drifting.',
  },
  {
    href: '/market',
    title: 'Sector demand',
    answers: 'India streaming demand around the two catalogues — DSP status, app proxies, regional charts.',
  },
  {
    href: '/stock',
    title: 'Stock',
    answers: 'Price, returns and risk. Kept deliberately apart from the nowcast: attention does not predict price here, and the page says so.',
  },
  {
    href: '/data',
    title: 'Raw data',
    answers: 'The tables themselves, downloadable as CSV.',
  },
];

export default async function EvidencePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-12 pt-8 md:px-12">
      <PageHead
        title="Evidence"
        kicker="Level 2 · the raw series"
        standfirst="Everything the estimate is built from, at the grain it was measured. Nothing here is modelled — where a value was inferred rather than observed, the page carrying it says so."
      />

      <div className="mb-8">
        <Suspense fallback={<span className="text-muted-foreground text-xs">checking…</span>}>
          <Freshness />
        </Suspense>
      </div>

      <ul className="border-border grid border-t sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((s) => (
          <li key={s.href} className="border-border border-b">
            <Link
              href={s.href}
              className="hover:bg-muted/60 block h-full px-0 py-5 pr-6 transition-colors sm:px-5"
            >
              <div className="font-serif text-lg font-semibold">{s.title}</div>
              <p className="text-muted-foreground mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed">
                {s.answers}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <div className="text-muted-foreground mt-10 max-w-[90ch] text-[11.5px] leading-relaxed">
        <Eyebrow className="mb-1.5">One caveat that applies to all of it</Eyebrow>
        YouTube intermittently serves a stale cumulative view count — the same figure for
        consecutive days across every channel at once, then the whole backlog in one reading.
        Roughly 4.7% of channel-days are affected. Daily deltas are repaired by redistributing a
        resolved plateau across the days it covers; where a day was inferred rather than observed,
        the page plotting it carries a footnote. The cumulative total is never modified.
      </div>
    </main>
  );
}

async function Freshness() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.overview, CACHE_TAGS.stock);
  const status = await getFreshness();
  return <FreshnessBadge status={status} />;
}
