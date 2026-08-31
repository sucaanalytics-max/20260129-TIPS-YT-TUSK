import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import {
  getOpsRunHistory,
  getRecentErrors,
  getCandidateSourceChannels,
  getDataQuality,
} from '@/lib/queries';
import { RunHistory } from '@/components/ops/run-history';
import { ErrorLog } from '@/components/ops/error-log';
import { CandidateTopicChannels } from '@/components/ops/candidate-topic-channels';
import { DataQuality } from '@/components/ops/data-quality';
import { CACHE_TAGS } from '@/lib/revalidate';

export default function OpsPage() {
  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-12 pt-8 md:px-12">
      <header className="mb-6">
        <h1 className="rule-double font-serif text-2xl font-bold tracking-[-0.01em] pb-3">Ops</h1>
        <p className="text-muted-foreground mt-3 max-w-[90ch] font-serif text-sm italic">
          Cron run history + error log for the last 7 days
        </p>
      </header>

      <section className="space-y-8">
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Recent runs</h2>
          <Suspense fallback={<Skeleton />}><Runs /></Suspense>
        </div>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">
            Data quality
          </h2>
          <Suspense fallback={<Skeleton />}><Quality /></Suspense>
        </div>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Errors</h2>
          <Suspense fallback={<Skeleton />}><Errors /></Suspense>
        </div>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">
            Candidate Topic channels (surfaced by UGC discovery)
          </h2>
          <Suspense fallback={<Skeleton />}><Candidates /></Suspense>
        </div>
      </section>
    </main>
  );
}

async function Candidates() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.ops);
  const candidates = await getCandidateSourceChannels({ minUgcCount: 2 });
  return <CandidateTopicChannels candidates={candidates} />;
}

async function Quality() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.channels);
  const snapshot = await getDataQuality({ days: 90 });
  return <DataQuality snapshot={snapshot} />;
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
