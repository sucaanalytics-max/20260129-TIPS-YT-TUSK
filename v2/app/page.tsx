import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getDualSymbolChartSeries,
  getEventHorizon,
  getOpsRunHistory,
  getSignalsSnapshot,
} from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { alignedLogReturns, criticalR, pearson } from '@/lib/correlation';
import { indexTo100, pairwise } from '@/lib/indexing';
import { parseStockRange, resolveStockRange } from '@/lib/stock-range';
import { Card, CardHead, Section, Shell } from '@/components/shell/app-shell';
import { ReadCard } from '@/components/monitor/read-card';
import { WhatChanged } from '@/components/monitor/what-changed';
import { EventsCard, PipelineCard } from '@/components/monitor/side-cards';
import { ReachVsPrice, type IndexedPoint } from '@/components/monitor/reach-vs-price';

/**
 * Monitor — the standing read.
 *
 * Answers "is anything different today?" before it answers anything else: two
 * read cards, then what moved ranked by how far it moved relative to its own
 * history, then the reach-against-price comparison the whole thesis rests on.
 */
export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const range = parseStockRange((await searchParams).range);

  return (
    <Shell>
      <Section id="read">
        <Suspense fallback={<PairSkeleton />}>
          <Reads />
        </Suspense>
      </Section>

      <Section id="what-changed" className="grid items-start gap-gap lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <Suspense fallback={<Block h={420} />}>
          <Changed />
        </Suspense>
        <div className="flex flex-col gap-gap">
          <Section id="events">
            <Suspense fallback={<Block h={190} />}>
              <Events />
            </Suspense>
          </Section>
          <Suspense fallback={<Block h={210} />}>
            <Pipeline />
          </Suspense>
        </div>
      </Section>

      <Section id="reach-vs-price">
        <Card>
          <CardHead title="Reach vs price" note="Indexed to 100 at the window start · views solid, price dashed">
            <div className="flex items-center gap-4 font-mono text-[11px]">
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-4" style={{ background: 'rgb(var(--tips))' }} />
                TIPSMUSIC
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-4" style={{ background: 'rgb(var(--sare))' }} />
                SAREGAMA
              </span>
            </div>
          </CardHead>
          <Suspense fallback={<Block h={330} bare />}>
            <ReachChart range={range} />
          </Suspense>
        </Card>
      </Section>
    </Shell>
  );
}

/* ---- data sections -------------------------------------------------------- */

async function Reads() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.overview, CACHE_TAGS.stock);

  const [tips, sare] = await Promise.all([
    getSignalsSnapshot({ company: 'TIPSMUSIC' }),
    getSignalsSnapshot({ company: 'SAREGAMA' }),
  ]);

  return (
    <div className="grid gap-gap lg:grid-cols-2">
      <ReadCard snapshot={tips} price={{ close: null, changePct1y: null }} />
      <ReadCard snapshot={sare} price={{ close: null, changePct1y: null }} />
    </div>
  );
}

async function Changed() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.channels);

  const [tips, sare] = await Promise.all([
    getSignalsSnapshot({ company: 'TIPSMUSIC' }),
    getSignalsSnapshot({ company: 'SAREGAMA' }),
  ]);
  return <WhatChanged snapshots={[tips, sare]} />;
}

async function Events() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.events);

  const events = await getEventHorizon({ days: 14 });
  return <EventsCard events={events} today={new Date().toISOString().slice(0, 10)} />;
}

async function Pipeline() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops);

  const runs = await getOpsRunHistory({ limit: 60 });
  return <PipelineCard runs={runs} now={Date.now()} />;
}

async function ReachChart({ range }: { range: ReturnType<typeof parseStockRange> }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.stock, CACHE_TAGS.channels);

  const { from, to } = resolveStockRange(range);
  const rows = await getDualSymbolChartSeries({ from, to });

  const tipsViews = indexTo100(rows.map((r) => r.tips_views));
  const tipsPrice = indexTo100(rows.map((r) => r.tips_close));
  const sareViews = indexTo100(rows.map((r) => r.sare_views));
  const sarePrice = indexTo100(rows.map((r) => r.sare_close));

  const data: IndexedPoint[] = rows.map((r, i) => ({
    date: r.date,
    tipsViews: tipsViews[i],
    tipsPrice: tipsPrice[i],
    sareViews: sareViews[i],
    sarePrice: sarePrice[i],
  }));

  /*
   * Correlate LOG CHANGES, not levels. Two series that both trend upward
   * correlate near 1 on levels regardless of whether they are related at all;
   * the question is whether they move together day to day.
   */
  const { x, y } = pairwise(
    alignedLogReturns(rows.map((r) => r.tips_views)),
    alignedLogReturns(rows.map((r) => r.tips_close)),
  );
  const r = x.length >= 3 ? pearson(x, y) : null;

  return (
    <ReachVsPrice
      data={data}
      correlation={{
        r,
        n: x.length,
        criticalR: x.length >= 3 ? criticalR(x.length) : null,
      }}
    />
  );
}

/* ---- skeletons ------------------------------------------------------------ */

function Block({ h, bare = false }: { h: number; bare?: boolean }) {
  return (
    <div
      className={`bg-surface2/50 animate-pulse ${bare ? '' : 'border-border rounded-card border'}`}
      style={{ height: h }}
    />
  );
}

function PairSkeleton() {
  return (
    <div className="grid gap-gap lg:grid-cols-2">
      <Block h={240} />
      <Block h={240} />
    </div>
  );
}
