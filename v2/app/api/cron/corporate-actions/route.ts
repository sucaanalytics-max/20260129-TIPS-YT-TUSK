import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Corporate actions ingest — STUB.
 *
 * Intended source: NSE corporate-actions feed (or BSE for cross-check). The
 * stubbed route currently logs a run and exits clean so the cron schedule and
 * audit trail are wired end-to-end. Implementation lands in a follow-up:
 *
 *   1. Fetch https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=TIPSMUSIC
 *   2. Parse each ('SPLIT', 'BONUS', 'DIVIDEND', etc.) into dim_corporate_action
 *      keyed by (symbol, ex_date, action_type).
 *   3. Re-derive adjusted_close on fct_price_daily for symbol on/after ex_date.
 *   4. Insert a matching dim_event row so the chart overlay sees it.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({
      source: 'corporate_actions',
      status: 'ok',
      ended_at: new Date().toISOString(),
      detail: { note: 'stub — implementation pending' },
    })
    .select('run_id')
    .single();

  return NextResponse.json({
    ok: true,
    run_id: runRow?.run_id ?? null,
    stub: true,
  });
}
