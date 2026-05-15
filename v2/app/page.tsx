import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getOverview,
  getFreshness,
  getDualAxisSeries,
  getLeadLagScan,
  getCompanyGrowth,
} from '@/lib/queries';
import { KpiGrid } from '@/components/kpi-grid';
import { FreshnessBadge } from '@/components/freshness-badge';
import { DualAxisLine } from '@/components/charts/dual-axis-line';
import { LeadLagBars } from '@/components/charts/lead-lag-bars';
import { CompanyGrowth } from '@/components/breakdowns/company-growth';
import { CACHE_TAGS } from '@/lib/revalidate';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>

      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">TIPS · YouTube × NSE</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tips Industries (TIPSMUSIC) catalogue performance correlated with equity price · Saregama benchmark
          </p>
        </div>
        <Suspense fallback={<span className="text-muted-foreground text-xs">checking…</span>}>
          <Freshness />
        </Suspense>
      </header>

      <Suspense fallback={<LoadingCards />}>
        <Overview />
      </Suspense>

      <section className="mt-10">
        <h2 className="text-foreground mb-4 text-sm font-medium uppercase tracking-wider">
          Daily views growth — Tips × Saregama
        </h2>
        <Suspense fallback={<LoadingMatrix />}>
          <GrowthMatrix />
        </Suspense>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<LoadingChart />}>
            <ViewsVsPrice />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<LoadingChart />}>
            <LeadLag />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function AuthGate() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return null;
}

async function Overview() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview);
  const data = await getOverview();
  return <KpiGrid data={data} />;
}

async function Freshness() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.overview, CACHE_TAGS.stock);
  const status = await getFreshness();
  return <FreshnessBadge status={status} />;
}

async function GrowthMatrix() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.channels);
  const snapshots = await getCompanyGrowth();
  return <CompanyGrowth snapshots={snapshots} />;
}

async function ViewsVsPrice() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.overview, CACHE_TAGS.stock, CACHE_TAGS.channels);
  const data = await getDualAxisSeries({ company: 'TIPSMUSIC' });
  return <DualAxisLine data={data} />;
}

async function LeadLag() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);
  const data = await getLeadLagScan({ window: 30 });
  return <LeadLagBars data={data} windowDays={30} />;
}

function LoadingCards() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border-border bg-card/50 h-28 animate-pulse rounded-lg border" />
      ))}
    </section>
  );
}

function LoadingMatrix() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}

function LoadingChart() {
  return <div className="border-border bg-card/50 h-80 animate-pulse rounded-lg border" />;
}
