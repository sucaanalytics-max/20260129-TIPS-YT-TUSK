import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDemandLayer, getStreamingRoyalty, getFreshness } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { FreshnessBadge } from '@/components/freshness-badge';
import { IndiaMarketStrip } from '@/components/market/india-market-strip';
import { StreamingRoyaltyStrip } from '@/components/market/streaming-royalty-strip';
import { DspStatusTable } from '@/components/market/dsp-status-table';
import { AppDemandStrip } from '@/components/market/app-demand-strip';
import { SpotifyRowStrip } from '@/components/market/spotify-row-strip';
import { CatalogChartStrip } from '@/components/market/catalog-chart-strip';

/**
 * /market — the India demand / paid-migration layer.
 *
 * Deliberately a SEPARATE surface from /signals. Everything here is
 * sector-wide: it answers "is the pie growing and shifting to paid?" and
 * explicitly NOT "what is TIPS's or Saregama's share?", because no public
 * per-catalog DSP stream data exists. Nothing on this page feeds composeRead's
 * bias scoring — keeping the IR READ measured-only is the whole point of the
 * split. Per-company capture still comes from YouTube + disclosed earnings on
 * /signals.
 *
 * Page order is the argument: the pie → the only hard paid evidence → demand
 * proxies → catalog presence → who is left standing → and only then what any
 * of it might imply for our two names.
 *
 * All five sector strips share ONE getDemandLayer() call inside a single
 * 'use cache' boundary. Splitting them into a boundary each would re-run the
 * same five-table query five times on every cache miss.
 */
export default function MarketPage() {
  return (
    <main className="mx-auto max-w-[1440px] px-6 pb-12 pt-8 md:px-12">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>

      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="rule-double font-serif text-2xl font-bold tracking-[-0.01em] pb-3">Market</h1>
          <p className="text-muted-foreground mt-3 max-w-[90ch] font-serif text-sm italic">
            India music-streaming demand · paid-migration tailwind — sector context, graded
            LOW, not weighted into the IR read
          </p>
        </div>
        <Suspense fallback={<span className="text-muted-foreground text-xs">checking…</span>}>
          <Freshness />
        </Suspense>
      </header>

      <div className="space-y-8">
        <Suspense fallback={<SectorSkeleton />}>
          <SectorLayer />
        </Suspense>

        <Suspense fallback={<Skeleton h="h-56" />}>
          <StreamingRoyalty />
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

async function Freshness() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.market);
  const status = await getFreshness();
  return <FreshnessBadge status={status} />;
}

/** Every sector strip, off a single demand-layer fetch. */
async function SectorLayer() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.market);
  const snapshot = await getDemandLayer();
  return (
    <div className="space-y-8">
      <IndiaMarketStrip snapshot={snapshot} />
      <SpotifyRowStrip snapshot={snapshot} />
      <AppDemandStrip snapshot={snapshot} />
      <CatalogChartStrip snapshot={snapshot} />
      <DspStatusTable snapshot={snapshot} />
    </div>
  );
}

/** The one per-company read on this page — and the weakest. Kept last. */
async function StreamingRoyalty() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.market);
  const [tips, sare] = await Promise.all([
    getStreamingRoyalty({ company: 'TIPSMUSIC' }),
    getStreamingRoyalty({ company: 'SAREGAMA' }),
  ]);
  return <StreamingRoyaltyStrip estimates={[tips, sare]} />;
}

function Skeleton({ h }: { h: string }) {
  return <div className={`border-border bg-card/50 ${h} animate-pulse rounded-lg border`} />;
}

function SectorSkeleton() {
  return (
    <div className="space-y-8">
      {['h-56', 'h-48', 'h-64', 'h-56', 'h-72'].map((h, i) => (
        <Skeleton key={i} h={h} />
      ))}
    </div>
  );
}
