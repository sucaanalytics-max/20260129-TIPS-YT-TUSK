import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchIndexQuote } from '@/lib/stocks';
import { marketIndexSymbols } from '@/lib/env';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 60;

/**
 * Daily market-index ingest. Pulls Yahoo Finance for the configured indices
 * (NIFTY MIDCAP 150 = ^CRSMID, NIFTY 50 = ^NSEI) and upserts into
 * dim_market_index. Powers the market-model β for the event-study service.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'market_index', status: 'running' })
    .select('run_id')
    .single();
  const runId = runRow?.run_id as number | undefined;
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'could not open run' }, { status: 500 });
  }

  const results: Array<{ name: string; ok: boolean; date?: string; close?: number; error?: string }> = [];

  for (const { name, symbol } of marketIndexSymbols) {
    try {
      const q = await fetchIndexQuote(symbol);
      const { error } = await supabase
        .from('dim_market_index')
        .upsert(
          {
            index_name: name,
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
            source: 'yahoo_finance',
            ingest_run_id: runId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'index_name,date' },
        );
      if (error) throw new Error(error.message);
      results.push({ name, ok: true, date: q.date, close: q.close });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
      await supabase.from('ops_error_log').insert({
        error_type: 'market_index_fetch_failed',
        error_message: (e as Error).message,
        detail: { name, symbol },
        ingest_run_id: runId,
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const status = okCount === results.length ? 'ok' : okCount > 0 ? 'partial' : 'failed';
  await supabase
    .from('ops_ingest_run')
    .update({
      status,
      ended_at: new Date().toISOString(),
      rows_in: results.length,
      rows_out: okCount,
      detail: { results },
    })
    .eq('run_id', runId);

  if (okCount > 0) bumpTags(CACHE_TAGS.stock, CACHE_TAGS.ops);

  return NextResponse.json({ ok: status !== 'failed', run_id: runId, results });
}
