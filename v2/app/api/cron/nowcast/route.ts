import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { storeNowcast } from '@/lib/queries';
import { bumpTags, CACHE_TAGS, type BumpResult } from '@/lib/revalidate';

export const maxDuration = 120;

/**
 * Appends today's revenue nowcast for each company.
 *
 * Runs daily so the estimate is a time series: how it moves as the quarter
 * fills in is most of its diagnostic value. Per-company failures are logged and
 * do not fail the run — the same posture as the other ingest crons.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const asof = new Date().toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'nowcast', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  const results: Array<{ company: string; ok: boolean; detail: string }> = [];
  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    try {
      const { fiscal, mid } = await storeNowcast({ company, asof, ingestRunId: runId });
      results.push({ company, ok: true, detail: `${fiscal.label} mid=${Math.round(mid)}` });
    } catch (err) {
      const message = (err as Error).message;
      results.push({ company, ok: false, detail: message });
      await supabase.from('ops_error_log').insert({
        error_type: 'nowcast_failed',
        error_message: message,
        detail: { company, asof },
        ingest_run_id: runId,
      });
    }
  }

  const written = results.filter((r) => r.ok).length;

  // Invalidate BEFORE closing the run so the outcome is recorded in the run
  // detail as well as returned. bumpTags never throws; a tag that fails to
  // revalidate leaves the dashboard serving a stale render over fresh rows,
  // which is exactly the failure that went unnoticed for two months (see
  // lib/revalidate.ts), so it is written down rather than dropped.
  const revalidate: BumpResult | null = written > 0 ? bumpTags(CACHE_TAGS.overview, CACHE_TAGS.ops) : null;

  await supabase
    .from('ops_ingest_run')
    .update({
      ended_at: new Date().toISOString(),
      status: written === results.length ? 'ok' : written > 0 ? 'partial' : 'failed',
      rows_in: results.length,
      rows_out: written,
      detail: { asof, results, revalidate },
    })
    .eq('run_id', runId);

  return NextResponse.json({ ok: written > 0, asof, run_id: runId, results, revalidate });
}
