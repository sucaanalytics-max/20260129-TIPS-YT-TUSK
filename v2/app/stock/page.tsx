import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getStockDeepDive,
  getReturnsMatrix,
  getRiskMetrics,
  getEarningsCalendar,
  getRelativePerformanceSeries,
  getCatalogDecayInputs,
} from '@/lib/queries';
import { fitCatalogDecay } from '@/lib/signals';
import {
  parseStockRange,
  parseStockSymbol,
  symbolsFor,
  type StockSymbolParam,
  type StockRange,
} from '@/lib/stock-range';
import { CACHE_TAGS } from '@/lib/revalidate';
import { SymbolTabs } from '@/components/stock/symbol-tabs';
import { RangeSelector } from '@/components/stock/range-selector';
import { HeroStats } from '@/components/stock/hero-stats';
import { ReturnsMatrix } from '@/components/stock/returns-matrix';
import { RiskPanel } from '@/components/stock/risk-panel';
import { RelativePerformanceChart } from '@/components/stock/relative-performance-chart';
import { CorporateActionsTable } from '@/components/stock/corporate-actions-table';
import { EarningsTable } from '@/components/stock/earnings-table';
import {
  StockPriceChart,
  StockPriceChartCompare,
} from '@/components/stock/price-chart';
import { CatalogDecayChart } from '@/components/stock/catalog-decay-chart';

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; range?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const params = await searchParams;
  const symbolParam: StockSymbolParam = parseStockSymbol(params.symbol);
  const range: StockRange = parseStockRange(params.range);
  const symbols = symbolsFor(symbolParam);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Stock {symbolParam !== 'compare' ? `· ${symbols[0]}` : '· Compare'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Equity research deep-dive · prices, returns, risk, relative performance, events
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SymbolTabs active={symbolParam} />
          <RangeSelector active={range} />
        </div>
      </header>

      <Suspense fallback={<HeroSkeleton />}>
        <Hero symbols={symbols} range={range} />
      </Suspense>

      <section className="mt-6">
        <Suspense fallback={<ChartSkeleton />}>
          <PriceBlock symbols={symbols} range={range} />
        </Suspense>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton />}>
          <Returns symbols={symbols} />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <Risk symbols={symbols} />
        </Suspense>
      </section>

      <section className="mt-6">
        <Suspense fallback={<ChartSkeleton />}>
          <RelPerf symbols={symbols} range={range} />
        </Suspense>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<CardSkeleton />}>
          <CorpActions symbols={symbols} range={range} />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <Earnings symbols={symbols} />
        </Suspense>
      </section>

      {symbolParam !== 'compare' && (
        <section className="mt-6">
          <Suspense fallback={<ChartSkeleton />}>
            <CatalogDecay symbol={symbols[0]} />
          </Suspense>
        </section>
      )}
    </main>
  );
}

async function Hero({ symbols, range }: { symbols: string[]; range: StockRange }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock);
  const deepDives = await Promise.all(
    symbols.map((s) => getStockDeepDive({ symbol: s, range })),
  );
  return (
    <div className={`grid gap-3 ${deepDives.length > 1 ? 'lg:grid-cols-2' : ''}`}>
      {deepDives.map((d) => (
        <HeroStats key={d.symbol} deepDive={d} />
      ))}
    </div>
  );
}

async function PriceBlock({ symbols, range }: { symbols: string[]; range: StockRange }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock, CACHE_TAGS.events, CACHE_TAGS.channels);
  const deepDives = await Promise.all(
    symbols.map((s) => getStockDeepDive({ symbol: s, range })),
  );
  if (deepDives.length > 1) {
    return <StockPriceChartCompare deepDives={deepDives} />;
  }
  return <StockPriceChart deepDive={deepDives[0]} />;
}

async function Returns({ symbols }: { symbols: string[] }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock);
  const rows = await Promise.all(symbols.map((s) => getReturnsMatrix({ symbol: s })));
  return <ReturnsMatrix rows={rows} />;
}

async function Risk({ symbols }: { symbols: string[] }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock);
  const metrics = await Promise.all(symbols.map((s) => getRiskMetrics({ symbol: s })));
  return <RiskPanel metrics={metrics} />;
}

async function RelPerf({ symbols, range }: { symbols: string[]; range: StockRange }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock);
  const series = await Promise.all(
    symbols.map(async (s) => ({
      symbol: s,
      color: s === 'TIPSMUSIC' ? '#60a5fa' : '#a78bfa',
      data: await getRelativePerformanceSeries({
        symbol: s,
        indexName: 'NIFTY_MIDCAP_150',
        range,
      }),
    })),
  );
  return <RelativePerformanceChart series={series} indexLabel="NIFTY MIDCAP 150" />;
}

async function CorpActions({
  symbols,
  range,
}: {
  symbols: string[];
  range: StockRange;
}) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock, CACHE_TAGS.events);
  const deepDives = await Promise.all(
    symbols.map((s) => getStockDeepDive({ symbol: s, range })),
  );
  return <CorporateActionsTable deepDives={deepDives} />;
}

async function Earnings({ symbols }: { symbols: string[] }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.events);
  const rows = (
    await Promise.all(symbols.map((s) => getEarningsCalendar({ symbol: s })))
  ).flat();
  return <EarningsTable rows={rows} multi={symbols.length > 1} />;
}

async function CatalogDecay({ symbol }: { symbol: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.stock, CACHE_TAGS.channels);
  const company = symbol === 'TIPSMUSIC' ? 'TIPSMUSIC' : 'SAREGAMA';
  const observations = await getCatalogDecayInputs({ company });
  const fit = fitCatalogDecay(observations);
  return <CatalogDecayChart observations={observations} fit={fit} symbol={symbol} />;
}

function HeroSkeleton() {
  return <div className="border-border bg-card/50 h-36 animate-pulse rounded-lg border" />;
}
function ChartSkeleton() {
  return <div className="border-border bg-card/50 h-96 animate-pulse rounded-lg border" />;
}
function CardSkeleton() {
  return <div className="border-border bg-card/50 h-72 animate-pulse rounded-lg border" />;
}
