import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getExplorerRows, getPeriodComparisons } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { ExplorerTable } from '@/components/explore/explorer-table';
import { PeriodComparison } from '@/components/explore/period-comparison';

/**
 * /explore — slice the series yourself.
 *
 * Everything here is the same daily grain the rest of the dashboard reads from,
 * exposed with filters rather than pre-chosen for you. The one rule the page
 * enforces is that it never implies precision it does not have: pre-2026 rows
 * carry no per-channel breakdown, and period comparisons spanning that change
 * are flagged rather than printed as clean percentages.
 */
export default function ExplorePage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Explore</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Views, subscriber adds and releases — filter, aggregate and compare periods
        </p>
      </header>

      <div className="space-y-6">
        <Suspense fallback={<Skeleton h="h-[34rem]" />}>
          <Table />
        </Suspense>
        <Suspense fallback={<Skeleton h="h-96" />}>
          <Quarters />
        </Suspense>
        <Suspense fallback={<Skeleton h="h-72" />}>
          <Years />
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

async function Table() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels, CACHE_TAGS.overview);
  return <ExplorerTable rows={await getExplorerRows({ from: '2023-01-01' })} />;
}

async function Quarters() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  return (
    <PeriodComparison
      sets={await getPeriodComparisons({ metric: 'views', granularity: 'quarter' })}
    />
  );
}

async function Years() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  return (
    <PeriodComparison
      sets={await getPeriodComparisons({ metric: 'views', granularity: 'year' })}
    />
  );
}

function Skeleton({ h }: { h: string }) {
  return <div className={`border-border bg-card/50 ${h} animate-pulse rounded-lg border`} />;
}
