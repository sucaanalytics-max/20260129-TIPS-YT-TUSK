import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getSignalsSnapshot,
  getLeadLagPanorama,
  getEventHorizon,
  getFreshness,
  getRankTrajectory,
  getUGCReach,
  getTopUGCCreators,
  getTopicReach,
} from '@/lib/queries';
import { composeRead } from '@/lib/signals';
import { CACHE_TAGS } from '@/lib/revalidate';
import { FreshnessBadge } from '@/components/freshness-badge';
import { ReadCard } from '@/components/signals/read-card';
import { SignalGrid } from '@/components/signals/signal-grid';
import { LeadLagPanorama } from '@/components/signals/lead-lag-panorama';
import { DivergenceCard } from '@/components/signals/divergence-card';
import { EventHorizonStrip } from '@/components/signals/event-horizon-strip';
import { RankTrajectoryStrip } from '@/components/signals/rank-trajectory-strip';
import { UGCReachStrip } from '@/components/signals/ugc-reach-strip';
import { UGCCreatorsStrip } from '@/components/signals/ugc-creators-strip';
import { TopicReachStrip } from '@/components/signals/topic-reach-strip';

export default function SignalsPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>

      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Signals</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            IR cockpit · what the read says right now, weighted by significance
          </p>
        </div>
        <Suspense fallback={<span className="text-muted-foreground text-xs">checking…</span>}>
          <Freshness />
        </Suspense>
      </header>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ReadSkeleton />}>
          <Read company="TIPSMUSIC" />
        </Suspense>
        <Suspense fallback={<ReadSkeleton />}>
          <Read company="SAREGAMA" />
        </Suspense>
      </section>

      <Suspense fallback={<GridSkeleton />}>
        <Grid />
      </Suspense>

      <section className="mt-8">
        <Suspense fallback={<PanoramaSkeleton />}>
          <RankTrajectory />
        </Suspense>
      </section>

      <section className="mt-8">
        <Suspense fallback={<PanoramaSkeleton />}>
          <TopicReach />
        </Suspense>
      </section>

      <section className="mt-8">
        <Suspense fallback={<PanoramaSkeleton />}>
          <UGCReach />
        </Suspense>
      </section>

      <section className="mt-8">
        <Suspense fallback={<PanoramaSkeleton />}>
          <UGCCreators />
        </Suspense>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<PanoramaSkeleton />}>
          <Panorama company="TIPSMUSIC" />
        </Suspense>
        <Suspense fallback={<PanoramaSkeleton />}>
          <Panorama company="SAREGAMA" />
        </Suspense>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={null}>
          <Divergence />
        </Suspense>
        <Suspense fallback={<PanoramaSkeleton />}>
          <Horizon />
        </Suspense>
      </section>
    </main>
  );
}

async function AuthGate() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  return null;
}

async function Freshness() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.signals);
  const status = await getFreshness();
  return <FreshnessBadge status={status} />;
}

async function Read({ company }: { company: 'TIPSMUSIC' | 'SAREGAMA' }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals);
  const snap = await getSignalsSnapshot({ company });
  const read = composeRead(snap);
  return <ReadCard company={company} read={read} asOf={snap.asOf} />;
}

async function Grid() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals);
  const [tips, sare] = await Promise.all([
    getSignalsSnapshot({ company: 'TIPSMUSIC' }),
    getSignalsSnapshot({ company: 'SAREGAMA' }),
  ]);
  return <SignalGrid snapshots={[tips, sare]} />;
}

async function Panorama({ company }: { company: 'TIPSMUSIC' | 'SAREGAMA' }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.correlation);
  // fct_correlation_window is TIPSMUSIC-only today
  const data = company === 'TIPSMUSIC' ? await getLeadLagPanorama({ window: 30 }) : [];
  return <LeadLagPanorama company={company} data={data} windowDays={30} />;
}

async function Divergence() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals);
  const [tips, sare] = await Promise.all([
    getSignalsSnapshot({ company: 'TIPSMUSIC' }),
    getSignalsSnapshot({ company: 'SAREGAMA' }),
  ]);
  return <DivergenceCard snapshots={[tips, sare]} />;
}

async function Horizon() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.events);
  const events = await getEventHorizon({ days: 30 });
  return <EventHorizonStrip events={events} />;
}

async function RankTrajectory() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.rank);
  const [tips, sare] = await Promise.all([
    getRankTrajectory({ company: 'TIPSMUSIC', days: 180 }),
    getRankTrajectory({ company: 'SAREGAMA', days: 180 }),
  ]);
  return (
    <RankTrajectoryStrip
      trajectories={[
        { company: 'TIPSMUSIC', points: tips },
        { company: 'SAREGAMA', points: sare },
      ]}
    />
  );
}

async function UGCReach() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals);
  const [tips, sare] = await Promise.all([
    getUGCReach({ company: 'TIPSMUSIC' }),
    getUGCReach({ company: 'SAREGAMA' }),
  ]);
  return <UGCReachStrip snapshots={[tips, sare]} />;
}

async function TopicReach() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals, CACHE_TAGS.channels);
  const [tips, sare] = await Promise.all([
    getTopicReach({ company: 'TIPSMUSIC', days: 60 }),
    getTopicReach({ company: 'SAREGAMA', days: 60 }),
  ]);
  return <TopicReachStrip snapshots={[tips, sare]} />;
}

async function UGCCreators() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.signals);
  const [tips, sare] = await Promise.all([
    getTopUGCCreators({ company: 'TIPSMUSIC', limit: 5 }),
    getTopUGCCreators({ company: 'SAREGAMA', limit: 5 }),
  ]);
  return (
    <UGCCreatorsStrip
      byCompany={[
        { company: 'TIPSMUSIC', creators: tips },
        { company: 'SAREGAMA', creators: sare },
      ]}
    />
  );
}

function ReadSkeleton() {
  return <div className="border-border bg-card/50 h-32 animate-pulse rounded-lg border" />;
}

function GridSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="border-border bg-card/50 h-28 animate-pulse rounded-lg border" />
      ))}
    </div>
  );
}

function PanoramaSkeleton() {
  return <div className="border-border bg-card/50 h-72 animate-pulse rounded-lg border" />;
}
