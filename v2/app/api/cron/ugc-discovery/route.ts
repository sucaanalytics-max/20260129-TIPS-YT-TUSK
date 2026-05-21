import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchShortsForSound, type ShortMatch } from '@/lib/youtube-ugc';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 300;

/**
 * Weekly UGC discovery cron.
 *
 * Strategy:
 *   1. Pick top-N owned-channel videos by latest total_views per company
 *   2. For each, scrape youtube.com/source/{video_id}/shorts to enumerate
 *      Shorts using that audio as their sound
 *   3. Upsert into fct_ugc_short_match keyed on (source, ugc, today)
 *
 * Cost: zero YT API quota. Pure HTML scrape. Sequential with a small delay
 * between requests to avoid triggering bot detection.
 *
 * Schedule: Sundays 07:30 UTC (= 13:00 IST), well after the daily YT crons
 * have refreshed total_views numbers so the anchor selection is current.
 *
 * Runtime envelope: ~50 anchors × (2s fetch + 1.5s delay) ≈ 175s, well
 * under maxDuration=300. If TOP_N_PER_COMPANY scales past ~40, or we add
 * music-panel verification per UGC, migrate this to Vercel Workflow
 * (durable execution, no time cap) instead of a Vercel Function.
 */

const TOP_N_PER_COMPANY = 25;
const SCRAPE_DELAY_MS = 1500;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'ugc_discovery', status: 'running' })
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
    const anchors = await selectAnchorVideos(supabase, TOP_N_PER_COMPANY);
    return await processAnchors(supabase, runId, today, anchors);
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'ugc_discovery_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await closeRun(supabase, runId, 'failed', null, null, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Pick top-N catalog videos by latest cumulative views for each tracked
 * company. We only anchor on long-form videos (is_short=false) — Shorts
 * have their own sound IDs and pivot pages, but using a Short as the
 * anchor would over-count Shorts-on-Shorts which isn't the UGC signal
 * we're after.
 */
async function selectAnchorVideos(
  supabase: ReturnType<typeof getServiceSupabase>,
  topN: number,
): Promise<Array<{ video_id: string; company: string }>> {
  const out: Array<{ video_id: string; company: string }> = [];
  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    // Owned channels of this company that ingest videos
    const { data: chans } = await supabase
      .from('dim_channel')
      .select('channel_id')
      .eq('company', company)
      .eq('channel_type', 'owned')
      .eq('is_active', true);
    const chanIds = (chans ?? []).map((c) => c.channel_id as string);
    if (chanIds.length === 0) continue;

    // Long-form videos in those channels
    const { data: vids } = await supabase
      .from('dim_video')
      .select('video_id')
      .in('channel_id', chanIds)
      .eq('is_short', false);
    const vidIds = (vids ?? []).map((v) => v.video_id as string);
    if (vidIds.length === 0) continue;

    // Latest fct_video_daily.views per video. We over-fetch the most recent
    // window and reduce in JS — sticking to one round-trip per company.
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const latestByVid = new Map<string, number>();
    // Chunk video_ids since IN clauses can get long
    for (let i = 0; i < vidIds.length; i += 200) {
      const slice = vidIds.slice(i, i + 200);
      const { data: facts } = await supabase
        .from('fct_video_daily')
        .select('video_id, date, views')
        .in('video_id', slice)
        .gte('date', since)
        .order('date', { ascending: false });
      for (const r of (facts ?? []) as Array<{
        video_id: string;
        date: string;
        views: number | null;
      }>) {
        if (r.views == null) continue;
        if (!latestByVid.has(r.video_id)) latestByVid.set(r.video_id, Number(r.views));
      }
    }
    const ranked = [...latestByVid.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([video_id]) => ({ video_id, company }));
    out.push(...ranked);
  }
  return out;
}

async function processAnchors(
  supabase: ReturnType<typeof getServiceSupabase>,
  runId: number,
  today: string,
  anchors: Array<{ video_id: string; company: string }>,
) {
  if (anchors.length === 0) {
    await closeRun(supabase, runId, 'ok', 0, 0, { note: 'no anchors to process' });
    return NextResponse.json({ ok: true, run_id: runId, anchors: 0 });
  }

  const perAnchor: Array<{
    source_video_id: string;
    company: string;
    matches: number;
    error?: string;
  }> = [];
  let totalUpserted = 0;

  for (const a of anchors) {
    try {
      const matches = await fetchShortsForSound(a.video_id);
      if (matches.length === 0) {
        perAnchor.push({ source_video_id: a.video_id, company: a.company, matches: 0 });
        continue;
      }
      const rows = matches.map((m: ShortMatch) => ({
        source_video_id: a.video_id,
        ugc_video_id: m.ugc_video_id,
        asof: today,
        view_count: m.view_count,
        view_count_text: m.view_count_text,
        channel_name: m.channel_name,
        raw_meta: m.raw_meta,
        ingest_run_id: runId,
      }));
      // Chunk to be safe on payload size
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await supabase
          .from('fct_ugc_short_match')
          .upsert(chunk, { onConflict: 'source_video_id,ugc_video_id,asof' });
        if (error) throw new Error(`upsert: ${error.message}`);
        totalUpserted += chunk.length;
      }
      perAnchor.push({
        source_video_id: a.video_id,
        company: a.company,
        matches: matches.length,
      });
    } catch (e) {
      perAnchor.push({
        source_video_id: a.video_id,
        company: a.company,
        matches: 0,
        error: (e as Error).message,
      });
    }
    // Pace requests
    await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));
  }

  const failed = perAnchor.filter((p) => p.error).length;
  const status: 'ok' | 'partial' | 'failed' =
    failed === 0 ? 'ok' : failed === anchors.length ? 'failed' : 'partial';
  const totalMatches = perAnchor.reduce((acc, p) => acc + p.matches, 0);

  await closeRun(supabase, runId, status, anchors.length, totalUpserted, {
    anchors: anchors.length,
    total_matches: totalMatches,
    upserted: totalUpserted,
    failed,
    per_anchor: perAnchor,
  });

  if (totalUpserted > 0) {
    bumpTags(CACHE_TAGS.signals, CACHE_TAGS.overview, CACHE_TAGS.ops);
  }

  return NextResponse.json({
    ok: true,
    run_id: runId,
    anchors: anchors.length,
    total_matches: totalMatches,
    upserted: totalUpserted,
    failed,
  });
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
