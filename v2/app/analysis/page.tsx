import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getControlChart, getLagCorrelations } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { ControlChart } from '@/components/analysis/control-chart';
import { LagCorrelationGrid } from '@/components/analysis/lag-correlation-grid';

/**
 * /analysis — the statistical surface.
 *
 * Control charts answer "is this process behaving normally?", which is a
 * different and more answerable question than "is the trend up?". The
 * correlation grid answers whether attention moves the share price, and its
 * finding is a null one — drawn as such rather than dressed up.
 */
export default function AnalysisPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Analysis</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Control limits and lag correlation · 110-day window
        </p>
      </header>

      <div className="space-y-6">
        <Suspense fallback={<Skeleton h="h-96" />}>
          <Charts />
        </Suspense>
        <Suspense fallback={<Skeleton h="h-[42rem]" />}>
          <Correlations />
        </Suspense>
      </div>
    </main>
  );
}

async function AuthGate() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return null;
}

async function Charts() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels, CACHE_TAGS.overview);
  const [tipsViews, tipsSubs, sareViews, sareSubs] = await Promise.all([
    getControlChart({ company: 'TIPSMUSIC', metric: 'views' }),
    getControlChart({ company: 'TIPSMUSIC', metric: 'subscribers' }),
    getControlChart({ company: 'SAREGAMA', metric: 'views' }),
    getControlChart({ company: 'SAREGAMA', metric: 'subscribers' }),
  ]);
  return (
    <div className="space-y-6">
      <ControlChart data={tipsViews} />
      <ControlChart data={sareViews} />
      <ControlChart data={tipsSubs} />
      <ControlChart data={sareSubs} />
    </div>
  );
}

async function Correlations() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels, CACHE_TAGS.stock);
  return <LagCorrelationGrid sets={await getLagCorrelations({})} />;
}

function Skeleton({ h }: { h: string }) {
  return <div className={`border-border bg-card/50 ${h} animate-pulse rounded-lg border`} />;
}
