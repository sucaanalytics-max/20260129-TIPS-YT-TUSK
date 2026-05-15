import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getDataTable, formatNumber } from '@/lib/queries';
import { getServiceSupabase } from '@/lib/supabase/server';
import { DateRange } from '@/components/filters/date-range';
import { ChannelMultiselect } from '@/components/filters/channel-multiselect';
import { CsvDownload } from '@/components/data/csv-download';
import { CACHE_TAGS } from '@/lib/revalidate';

interface Search {
  from?: string;
  to?: string;
  channels?: string;
}

export default function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Filterable per-channel daily rows · CSV export
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Suspense fallback={<div className="h-7 w-64" />}>
          <DateRange defaultDays={90} />
        </Suspense>
        <Suspense fallback={<div className="h-9 w-48" />}>
          <ChannelPicker />
        </Suspense>
      </div>

      <Suspense fallback={<Skeleton />}>
        <TableWrapper searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ChannelPicker() {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('dim_channel')
    .select('channel_id, channel_name, company')
    .eq('is_active', true)
    .order('company', { ascending: true })
    .order('channel_name', { ascending: true });
  return (
    <ChannelMultiselect
      channels={(data ?? []) as { channel_id: string; channel_name: string; company: string }[]}
    />
  );
}

async function TableWrapper({ searchParams }: { searchParams: Promise<Search> }) {
  const { from, to, channels } = await searchParams;
  const channelIds = channels?.split(',').filter(Boolean);
  const fromDate = from ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const toDate = to ?? new Date().toISOString().slice(0, 10);
  return <Table from={fromDate} to={toDate} channelIds={channelIds} />;
}

async function Table({
  from,
  to,
  channelIds,
}: {
  from: string;
  to: string;
  channelIds?: string[];
}) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);
  const rows = await getDataTable({ from, to, channelIds });

  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no rows for selection
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {rows.length.toLocaleString()} rows · {from} → {to}
        </p>
        <CsvDownload rows={rows} filename={`tusk-channels-${from}_${to}.csv`} />
      </div>
      <div className="border-border bg-card overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-border text-muted-foreground sticky top-0 border-b text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">Co</th>
              <th className="px-3 py-2">Lang</th>
              <th className="px-3 py-2 text-right">Total views</th>
              <th className="px-3 py-2 text-right">Subs</th>
              <th className="px-3 py-2 text-right">Daily views</th>
              <th className="px-3 py-2 text-right">Δ subs</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 1000).map((r) => (
              <tr key={`${r.date}-${r.channel_id}`} className="border-border/30 hover:bg-muted/30 border-b last:border-0">
                <td className="px-3 py-1.5 font-mono text-xs">{r.date}</td>
                <td className="px-3 py-1.5 text-xs">{r.channel_name}</td>
                <td className="text-muted-foreground px-3 py-1.5 text-xs">{r.company}</td>
                <td className="text-muted-foreground px-3 py-1.5 text-xs">{r.language ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatNumber(r.total_views)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatNumber(r.subscribers)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatNumber(r.daily_views)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{formatNumber(r.daily_subscribers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 1000 ? (
          <p className="text-muted-foreground px-4 py-3 text-xs">
            Showing first 1,000 rows · use CSV download for full dataset
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="border-border bg-card/50 h-96 animate-pulse rounded-lg border" />;
}
