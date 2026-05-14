import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchStockPrice } from '@/lib/stocks';
import { stockSymbols } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily stock-price ingest (NSE close). Yahoo Finance primary, NSE fallback.
 * One row per (symbol, trading_date) upserted into fct_price_daily.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();

  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'stocks', status: 'running' })
    .select('run_id')
    .single();
  const runId = runRow?.run_id as string | undefined;
  if (!runId) return NextResponse.json({ ok: false, error: 'could not open run' }, { status: 500 });

  const results: Array<{ symbol: string; ok: boolean; date?: string; error?: string }> = [];

  try {
    for (const symbol of stockSymbols) {
      try {
        const p = await fetchStockPrice(symbol);

        // retain raw payload
        await supabase.from('raw_stock').insert({
          source: p.source,
          symbol,
          response_payload: p,
          ingest_run_id: runId,
        });

        const { error } = await supabase
          .from('fct_price_daily')
          .upsert(
            {
              symbol: p.symbol,
              date: p.date,
              open: p.open,
              high: p.high,
              low: p.low,
              close: p.close,
              volume: p.volume,
              source: p.source,
              ingest_run_id: runId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'symbol,date' },
          );
        if (error) throw new Error(`fct_price_daily upsert: ${error.message}`);

        results.push({ symbol, ok: true, date: p.date });
      } catch (e) {
        results.push({ symbol, ok: false, error: (e as Error).message });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const status = okCount === results.length ? 'ok' : okCount > 0 ? 'partial' : 'failed';
    await closeRun(supabase, runId, status, results.length, okCount, { results });
    return NextResponse.json({ ok: status !== 'failed', run_id: runId, results });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'stocks_ingest_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await closeRun(supabase, runId, 'failed', null, null, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function closeRun(
  supabase: ReturnType<typeof getServiceSupabase>,
  run_id: string,
  status: 'ok' | 'partial' | 'failed',
  rows_in: number | null,
  rows_out: number | null,
  detail: Record<string, unknown>,
) {
  await supabase
    .from('ops_ingest_run')
    .update({ ended_at: new Date().toISOString(), status, rows_in, rows_out, detail })
    .eq('run_id', run_id);
}
