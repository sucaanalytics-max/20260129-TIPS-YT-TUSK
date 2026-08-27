import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';

export const maxDuration = 300;

/**
 * UGC sweep PLANNER (cursor-batched discovery, step 1 of 2).
 *
 * Seeds ugc_discovery_queue with one row per anchor for today's sweep. An
 * "anchor" is now EVERY owned+topic long-form video above a lifetime-view
 * threshold (vs the old fixed top-25/company) — the aggressive coverage tier.
 * The ugc-work cron then drains the queue a bounded slice per tick so no single
 * invocation hits the 300s function cap.
 *
 * Idempotent: re-running for the same sweep_date inserts only new anchors
 * (ignoreDuplicates) and never resets already-processed rows.
 *
 * Schedule: weekly, just before the worker window (see vercel.json).
 */

// Anchor on every owned/topic long-form video with at least this many lifetime
// views. Validated counts (2026-06): 100k → 361 anchors, 500k → 128, 1M → 87,
// all-tracked → 2,678 (topic videos aren't ingested yet, so anchors are
// owned-only). 100k is the aggressive-but-no-proxy tier (~7× the old
// top-25/company ≈ 50). Lower for wider coverage — past a few hundred anchors
// the scrape volume needs proxy rotation (see review). The worker spreads the
// volume across ticks.
const ANCHOR_MIN_VIEWS = 100_000;
// Safety cap so one sweep can't seed an unbounded queue.
const MAX_ANCHORS_PER_SWEEP = 1500;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const sweepDate = new Date().toISOString().slice(0, 10);

  // Self-heal any stale planner run (killed before closeRun).
  await supabase
    .from('ops_ingest_run')
    .update({
      status: 'failed',
      ended_at: new Date().toISOString(),
      detail: { note: 'auto-closed: stale running run' },
    })
    .eq('source', 'ugc_plan')
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 310_000).toISOString());

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'ugc_plan', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  try {
    const { data: anchors, error } = await supabase.rpc('select_ugc_anchors', {
      p_min_views: ANCHOR_MIN_VIEWS,
      p_max_anchors: MAX_ANCHORS_PER_SWEEP,
    });
    if (error) throw new Error(`select_ugc_anchors: ${error.message}`);

    const rows = ((anchors ?? []) as Array<{
      video_id: string;
      company: string | null;
      source_kind: string;
    }>).map((a) => ({
      sweep_date: sweepDate,
      source_video_id: a.video_id,
      company: a.company,
      source_kind: a.source_kind,
      status: 'pending',
    }));

    let seeded = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from('ugc_discovery_queue')
        .upsert(chunk, { onConflict: 'sweep_date,source_video_id', ignoreDuplicates: true });
      if (upErr) throw new Error(`seed queue: ${upErr.message}`);
      seeded += chunk.length;
    }

    await supabase
      .from('ops_ingest_run')
      .update({
        status: 'ok',
        ended_at: new Date().toISOString(),
        rows_out: seeded,
        detail: { sweep_date: sweepDate, anchors: seeded, min_views: ANCHOR_MIN_VIEWS },
      })
      .eq('run_id', runId);

    return NextResponse.json({ ok: true, run_id: runId, sweep_date: sweepDate, anchors: seeded });
  } catch (err) {
    const message = (err as Error).message;
    await supabase
      .from('ops_ingest_run')
      .update({ status: 'failed', ended_at: new Date().toISOString(), detail: { error: message } })
      .eq('run_id', runId);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
