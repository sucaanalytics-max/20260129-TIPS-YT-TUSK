import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getDualSymbolHeadline,
  getDualSymbolChartSeries,
  getCompanyGrowth,
  getFreshness,
  getEventHorizon,
  getOpsRunHistory,
} from '@/lib/queries';
import {
  parseStockRange,
  resolveStockRange,
  STOCK_RANGE_LABEL,
  type StockRange,
} from '@/lib/stock-range';
import { CACHE_TAGS } from '@/lib/revalidate';
import { FreshnessBadge } from '@/components/freshness-badge';
import { CompanyGrowth } from '@/components/breakdowns/company-growth';
import { EventHorizonStrip } from '@/components/signals/event-horizon-strip';
import { DualSymbolKpiStrip } from '@/components/overview/dual-symbol-kpi-strip';
import { DualSymbolChart } from '@/components/overview/dual-symbol-chart';
import { PipelinePulse } from '@/components/overview/pipeline-pulse';
import { RangeSelector } from '@/components/stock/range-selector';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const params = await searchParams;
  const range: StockRange = parseStockRange(params.range);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">TUSK · YT × NSE</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Daily monitor — TIPSMUSIC + SAREGAMA · range:{' '}
            <span className="text-foreground font-medium">{STOCK_RANGE_LABEL[range]}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangeSelector active={range} />
          <Suspense fallback={<span className="text-muted-foreground text-xs">checking…</span>}>
            <Freshness />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={<KpiSkeleton />}>
        <Headline range={range} />
      </Suspense>

      <section className="mt-8">
        <Suspense fallback={<ChartSkeleton />}>
          <ChartBlock range={range} />
        </Suspense>
      </section>

      <section className="mt-10">
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Growth — daily views, current vs prior period
        </h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Multi-period reference (independent of the page range selector).
        </p>
        <Suspense fallback={<MatrixSkeleton />}>
          <Growth />
        </Suspense>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton />}>
          <Events />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <Pulse />
        </Suspense>
      </section>
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

async function Headline({ range }: { range: StockRange }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.stock, CACHE_TAGS.channels);
  const rows = await getDualSymbolHeadline({ range });
  return <DualSymbolKpiStrip rows={rows} />;
}

async function ChartBlock({ range }: { range: StockRange }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.stock, CACHE_TAGS.channels);
  const { from, to } = resolveStockRange(range);
  const data = await getDualSymbolChartSeries({ from, to });
  return <DualSymbolChart data={data} />;
}

async function Growth() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.channels);
  const snapshots = await getCompanyGrowth();
  return <CompanyGrowth snapshots={snapshots} />;
}

async function Events() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.events);
  const events = await getEventHorizon({ days: 14 });
  return <EventHorizonStrip events={events} />;
}

async function Pulse() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops);
  const runs = await getOpsRunHistory({ limit: 5 });
  return <PipelinePulse runs={runs} />;
}

function KpiSkeleton() {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-border bg-card/50 h-28 animate-pulse rounded-lg border" />
      ))}
    </section>
  );
}

function ChartSkeleton() {
  return <div className="border-border bg-card/50 h-80 animate-pulse rounded-lg border" />;
}

function MatrixSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}

function CardSkeleton() {
  return <div className="border-border bg-card/50 h-48 animate-pulse rounded-lg border" />;
}
