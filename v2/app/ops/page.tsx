import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getOpsRunHistory, getRecentErrors } from '@/lib/queries';
import { RunHistory } from '@/components/ops/run-history';
import { ErrorLog } from '@/components/ops/error-log';
import { CACHE_TAGS } from '@/lib/revalidate';

export default function OpsPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cron run history + error log for the last 7 days
        </p>
      </header>

      <section className="space-y-8">
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Recent runs</h2>
          <Suspense fallback={<Skeleton />}><Runs /></Suspense>
        </div>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Errors</h2>
          <Suspense fallback={<Skeleton />}><Errors /></Suspense>
        </div>
      </section>
    </main>
  );
}

async function Runs() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops);
  const runs = await getOpsRunHistory({});
  return <RunHistory runs={runs} />;
}

async function Errors() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops);
  const errors = await getRecentErrors({});
  return <ErrorLog errors={errors} />;
}

function Skeleton() {
  return <div className="border-border bg-card/50 h-40 animate-pulse rounded-lg border" />;
}
