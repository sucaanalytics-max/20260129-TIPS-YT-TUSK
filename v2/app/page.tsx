import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getOverview, getFreshness } from '@/lib/queries';
import { KpiGrid } from '@/components/kpi-grid';
import { FreshnessBadge } from '@/components/freshness-badge';

export default async function HomePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">TIPS · YouTube × NSE</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tips Industries (TIPSMUSIC) catalogue performance correlated with equity price · Saregama benchmark
          </p>
        </div>
        <Suspense fallback={<span className="text-xs text-muted-foreground">checking…</span>}>
          <Freshness />
        </Suspense>
      </header>

      <Overview />
    </main>
  );
}

async function Overview() {
  'use cache';
  cacheLife('hours');
  cacheTag('overview');
  const data = await getOverview();
  return <KpiGrid data={data} />;
}

async function Freshness() {
  const status = await getFreshness();
  return <FreshnessBadge status={status} />;
}
