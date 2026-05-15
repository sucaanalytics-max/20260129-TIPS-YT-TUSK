import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getRollingCorrelation, getLeadLagScan } from '@/lib/queries';
import { RollingCorrelation } from '@/components/charts/rolling-correlation';
import { LeadLagBars } from '@/components/charts/lead-lag-bars';
import { CACHE_TAGS } from '@/lib/revalidate';
import { getServiceSupabase } from '@/lib/supabase/server';

export default function CorrelationPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Correlation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Log-returns × log-growth-views — rolling Pearson r at multiple windows · Granger summary below
        </p>
      </header>

      <section className="space-y-8">
        <Suspense fallback={<Skeleton />}><RollingBlock /></Suspense>
        <Suspense fallback={<Skeleton />}><LeadLagBlock /></Suspense>
        <Suspense fallback={<Skeleton />}><GrangerBlock /></Suspense>
      </section>
    </main>
  );
}

async function RollingBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);
  const [w7, w30, w60, w120] = await Promise.all([
    getRollingCorrelation({ window: 7, lag: 0 }),
    getRollingCorrelation({ window: 30, lag: 0 }),
    getRollingCorrelation({ window: 60, lag: 0 }),
    getRollingCorrelation({ window: 120, lag: 0 }),
  ]);
  return <RollingCorrelation byWindow={{ 7: w7, 30: w30, 60: w60, 120: w120 }} />;
}

async function LeadLagBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);
  const data = await getLeadLagScan({ window: 30 });
  return <LeadLagBars data={data} windowDays={30} />;
}

async function GrangerBlock() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);
  const supabase = getServiceSupabase();
  const { data: latestAsof } = await supabase
    .from('fct_granger_summary')
    .select('asof')
    .order('asof', { ascending: false })
    .limit(1);
  const asof = latestAsof?.[0]?.asof;
  if (!asof) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no Granger results yet — run /api/stats/recompute
      </div>
    );
  }
  const { data } = await supabase
    .from('fct_granger_summary')
    .select('direction, lag, f_statistic, p_value, n_obs')
    .eq('asof', asof)
    .order('direction', { ascending: true })
    .order('lag', { ascending: true });
  const rows = (data ?? []) as Array<{ direction: string; lag: number; f_statistic: number; p_value: number; n_obs: number }>;
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <header className="border-border border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-medium">Granger causality — asof {asof}</h2>
        <p className="text-muted-foreground text-xs">F-test p &lt; 0.05 ⇒ rejects null of no causality at that lag</p>
      </header>
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Direction</th>
            <th className="px-4 py-3 text-right">Lag</th>
            <th className="px-4 py-3 text-right">F-stat</th>
            <th className="px-4 py-3 text-right">p-value</th>
            <th className="px-4 py-3 text-right">n</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.direction}-${r.lag}`} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
              <td className="px-4 py-2 font-mono text-xs">{r.direction}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.lag}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.f_statistic.toFixed(3)}</td>
              <td className={`px-4 py-2 text-right tabular-nums ${r.p_value < 0.05 ? 'text-emerald-400' : ''}`}>
                {r.p_value.toFixed(4)}
              </td>
              <td className="text-muted-foreground px-4 py-2 text-right tabular-nums">{r.n_obs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton() {
  return <div className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />;
}
