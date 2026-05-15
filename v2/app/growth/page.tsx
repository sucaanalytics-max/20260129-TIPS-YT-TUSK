import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import {
  getCompanyGrowth,
  getChannelGrowth,
  getCompanyViewsSeries,
} from '@/lib/queries';
import { CompanyGrowth } from '@/components/breakdowns/company-growth';
import { ChannelGrowth } from '@/components/breakdowns/channel-growth';
import { CompanyViewsLine } from '@/components/charts/company-views-line';
import { CACHE_TAGS } from '@/lib/revalidate';

interface Search { company?: string }

export default function GrowthPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Growth</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Period-over-period daily views growth — company aggregates + per-channel table
        </p>
        <Suspense fallback={<div className="mt-4 h-8" />}>
          <Tabs searchParams={searchParams} />
        </Suspense>
      </header>

      <section className="space-y-10">
        <Suspense fallback={<MatrixSkeleton />}>
          <CompanyBlock />
        </Suspense>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">
            Daily views — time series (toggle Abs / 7DMA / 30DMA / 45DMA)
          </h2>
          <Suspense fallback={<ChartSkeleton />}>
            <CompanyViewsBlock />
          </Suspense>
        </div>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">
            Per-channel growth (sortable · 60d sparklines per row)
          </h2>
          <Suspense fallback={<TableSkeleton />}>
            <ChannelsWrapper searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function Tabs({ searchParams }: { searchParams: Promise<Search> }) {
  const { company } = await searchParams;
  return (
    <div className="mt-4 flex gap-2 text-xs">
      {(['TIPSMUSIC', 'SAREGAMA', undefined] as const).map((c) => (
        <a
          key={String(c)}
          href={c ? `/growth?company=${c}` : '/growth'}
          className={`rounded-md border px-2.5 py-1 ${
            (company ?? '') === (c ?? '')
              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
              : 'border-border text-muted-foreground'
          }`}
        >
          {c ?? 'Both'}
        </a>
      ))}
    </div>
  );
}

async function CompanyBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.channels);
  const snapshots = await getCompanyGrowth();
  return <CompanyGrowth snapshots={snapshots} />;
}

async function CompanyViewsBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const data = await getCompanyViewsSeries({});
  return <CompanyViewsLine data={data} />;
}

async function ChannelsWrapper({ searchParams }: { searchParams: Promise<Search> }) {
  const { company } = await searchParams;
  return <ChannelsBlock company={company} />;
}

async function ChannelsBlock({ company }: { company?: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const rows = await getChannelGrowth({ company });
  return <ChannelGrowth rows={rows} />;
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

function ChartSkeleton() {
  return <div className="border-border bg-card/50 h-80 animate-pulse rounded-lg border" />;
}

function TableSkeleton() {
  return <div className="border-border bg-card/50 h-96 animate-pulse rounded-lg border" />;
}
