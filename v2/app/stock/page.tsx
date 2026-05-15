import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getPriceWithEvents } from '@/lib/queries';
import { PriceWithEvents } from '@/components/charts/price-with-events';
import { CACHE_TAGS } from '@/lib/revalidate';

export default function StockPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          TIPSMUSIC daily close with corporate-action-adjusted overlay · markers = splits, bonuses, dividends
        </p>
      </header>

      <Suspense fallback={<Skeleton />}>
        <PriceBlock />
      </Suspense>
    </main>
  );
}

async function PriceBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock);
  const { prices, corp_actions } = await getPriceWithEvents({});
  return <PriceWithEvents prices={prices} corp_actions={corp_actions} />;
}

function Skeleton() {
  return <div className="border-border bg-card/50 h-96 animate-pulse rounded-lg border" />;
}
