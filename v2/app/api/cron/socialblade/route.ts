import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import {
  creditsRemaining,
  fetchSocialBladeChannel,
  isSocialBladeNotIndexed,
  snapshotRowFromResponse,
  socialBladeConfigured,
} from '@/lib/socialblade';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 120;

/**
 * Weekly SocialBlade snapshot for all active channels.
 *
 * Schedule: `0 6 * * 0` (Sunday 06:00 UTC ≈ 11:30 IST) via vercel.json.
 * Cost: ~39 credits/week (1 credit per channel; SB cache hits free).
 *
 * Writes one row per (channel_id, today) into fct_channel_sb_snapshot.
 * Idempotent — same-day reruns DO UPDATE. Per-channel failures land in
 * ops_error_log; the cron stays 'partial' rather than 'failed'.
 *
 * If SB creds are absent, the cron is a no-op (writes a 'skipped' run row).
 * If the response's `info.credits.available` drops below 100, an early-warning
 * row is written to ops_error_log so we have time to top up the plan.
 */
const SB_QUOTA_WARN_THRESHOLD = 100;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'socialblade', status: 'running' })
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
    if (!socialBladeConfigured()) {
      await closeRun(supabase, runId, 'ok', 0, 0, {
        note: 'SocialBlade not configured (SOCIALBLADE_CLIENT_ID/SOCIALBLADE_TOKEN absent)',
      });
      return NextResponse.json({ ok: true, skipped: true, run_id: runId });
    }

    const { data: channels, error: chErr } = await supabase
      .from('dim_channel')
      .select('channel_id, channel_name')
      .eq('is_active', true);
    if (chErr) throw new Error(`dim_channel query: ${chErr.message}`);
    if (!channels?.length) {
      await closeRun(supabase, runId, 'ok', 0, 0, { note: 'no active channels' });
      return NextResponse.json({ ok: true, channels: 0, run_id: runId });
    }

    const rows: Record<string, unknown>[] = [];
    const skipped: Array<{ channel_id: string; reason: string }> = [];
    const failed: Array<{ channel_id: string; error: string }> = [];
    let lastCredits: number | null = null;

    for (const ch of channels) {
      try {
        const res = await fetchSocialBladeChannel(ch.channel_id);
        const credits = creditsRemaining(res);
        if (credits != null) lastCredits = credits;
        if (!res.status?.success) {
          skipped.push({
            channel_id: ch.channel_id,
            reason: res.status?.error ?? 'sb-unsuccessful',
          });
          continue;
        }
        const row = snapshotRowFromResponse(ch.channel_id, today, res, runId);
        if (row) rows.push(row);
      } catch (e) {
        if (isSocialBladeNotIndexed(e)) {
          skipped.push({ channel_id: ch.channel_id, reason: 'sb-not-indexed (404)' });
        } else {
          failed.push({ channel_id: ch.channel_id, error: (e as Error).message });
        }
      }
    }

    // Chunked upsert (PG limit on VALUES is generous; 25 is safe)
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      const { error } = await supabase
        .from('fct_channel_sb_snapshot')
        .upsert(chunk, { onConflict: 'channel_id,asof' });
      if (error) {
        failed.push(
          ...chunk.map((r) => ({
            channel_id: r.channel_id as string,
            error: `upsert: ${error.message}`,
          })),
        );
      } else {
        upserted += chunk.length;
      }
    }

    if (lastCredits != null && lastCredits < SB_QUOTA_WARN_THRESHOLD) {
      await supabase.from('ops_error_log').insert({
        error_type: 'sb_quota_low',
        error_message: `SocialBlade credits below ${SB_QUOTA_WARN_THRESHOLD}: ${lastCredits} remaining`,
        ingest_run_id: runId,
        detail: { credits_remaining: lastCredits, threshold: SB_QUOTA_WARN_THRESHOLD },
      });
    }

    const status =
      failed.length > 0 ? 'partial' : skipped.length > 0 ? 'partial' : 'ok';
    await closeRun(supabase, runId, status, channels.length, upserted, {
      upserted,
      skipped,
      failed,
      credits_remaining: lastCredits,
    });

    if (upserted > 0) bumpTags(CACHE_TAGS.rank, CACHE_TAGS.signals, CACHE_TAGS.overview, CACHE_TAGS.ops);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      channels: channels.length,
      upserted,
      skipped: skipped.length,
      failed: failed.length,
      credits_remaining: lastCredits,
    });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'socialblade_cron_failed',
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
  run_id: number,
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
