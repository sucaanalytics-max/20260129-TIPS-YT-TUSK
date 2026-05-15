import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getChannelLeaderboard, getLanguageRollup, getChannelGrowth } from '@/lib/queries';
import { ChannelLeaderboard } from '@/components/breakdowns/channel-leaderboard';
import { LanguageRollup } from '@/components/breakdowns/language-rollup';
import { ChannelGrowth } from '@/components/breakdowns/channel-growth';
import { CACHE_TAGS } from '@/lib/revalidate';

interface Search { company?: string }

export default function ChannelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Per-channel daily stats and language rollup · subscriber deltas are noisy below 1k subs due to YT rounding
        </p>
        <Suspense fallback={<div className="mt-4 h-8" />}>
          <Tabs searchParams={searchParams} />
        </Suspense>
      </header>

      <section className="space-y-8">
        <Suspense fallback={<TableSkeleton />}>
          <LeaderboardBlock searchParams={searchParams} />
        </Suspense>
        <div>
          <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">
            Per-channel growth (WoW · MoM · QoQ)
          </h2>
          <Suspense fallback={<TableSkeleton />}>
            <GrowthBlock searchParams={searchParams} />
          </Suspense>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <LanguageBlock />
        </Suspense>
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
          href={c ? `/channels?company=${c}` : '/channels'}
          className={`rounded-md border px-2.5 py-1 ${
            (company ?? '') === (c ?? '')
              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
              : 'border-border text-muted-foreground'
          }`}
        >
          {c ?? 'All'}
        </a>
      ))}
    </div>
  );
}

async function LeaderboardBlock({ searchParams }: { searchParams: Promise<Search> }) {
  const { company } = await searchParams;
  return <CachedLeaderboard company={company} />;
}

async function CachedLeaderboard({ company }: { company?: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const rows = await getChannelLeaderboard({ company });
  return (
    <div>
      <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Channel leaderboard</h2>
      <ChannelLeaderboard rows={rows} />
    </div>
  );
}

async function LanguageBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const rows = await getLanguageRollup({});
  return (
    <div>
      <h2 className="text-foreground mb-3 text-sm font-medium uppercase tracking-wider">Language rollup (7d)</h2>
      <LanguageRollup rows={rows} />
    </div>
  );
}

async function GrowthBlock({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  return <GrowthInner company={company} />;
}

async function GrowthInner({ company }: { company?: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const rows = await getChannelGrowth({ company });
  return <ChannelGrowth rows={rows} />;
}

function TableSkeleton() {
  return <div className="border-border bg-card/50 h-40 animate-pulse rounded-lg border" />;
}
