import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import {
  enrichUGCVideos,
  fetchMusicAttribution,
  fetchShortsForSound,
  resolveVideoChannels,
  type ShortMatch,
} from '@/lib/youtube-ugc';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';
import { env } from '@/lib/env';

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
// I3: number of high-view UGC Shorts we sample for music-panel attribution
// each run. Capped to stay within the 5min function budget. 30 × ~1.8s
// (fetch + delay) ≈ 54s on top of pivot (175s) + enrich (~10s) — total
// envelope ~240s vs maxDuration 300. If we expand this, migrate the
// route to a Vercel Workflow for unbounded runtime.
const ATTRIBUTION_SAMPLE_SIZE = 30;
const ATTRIBUTION_DELAY_MS = 800;
// I1: re-enrich a UGC row this often (days). Channel info rarely changes;
// most UGC re-appears week-over-week so we don't need to refetch each time.
const ENRICHMENT_TTL_DAYS = 14;

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

  // ---- I1: Enrich every discovered UGC video via videos.list -----------
  // Re-fetch today's UGC ids from the table — cleanest source of truth
  // since perAnchor only tracks counts.
  const { data: todayRows } = await supabase
    .from('fct_ugc_short_match')
    .select('ugc_video_id')
    .eq('asof', today)
    .in(
      'source_video_id',
      anchors.map((a) => a.video_id),
    );
  const ugcIds = Array.from(
    new Set(((todayRows ?? []) as Array<{ ugc_video_id: string }>).map((r) => r.ugc_video_id)),
  );

  let enrichedCount = 0;
  let attributionChecked = 0;
  const attributionCounts: Record<string, number> = {};

  if (ugcIds.length > 0 && env.YOUTUBE_API_KEY) {
    // Skip videos we enriched recently (TTL filter)
    const ttlCutoff = new Date(
      Date.now() - ENRICHMENT_TTL_DAYS * 86_400_000,
    ).toISOString();
    const idsToEnrich: string[] = [];
    for (let i = 0; i < ugcIds.length; i += 200) {
      const slice = ugcIds.slice(i, i + 200);
      const { data: existing } = await supabase
        .from('dim_ugc_video')
        .select('ugc_video_id, enriched_at')
        .in('ugc_video_id', slice);
      const recentlyEnriched = new Set(
        ((existing ?? []) as Array<{ ugc_video_id: string; enriched_at: string | null }>)
          .filter((r) => r.enriched_at != null && r.enriched_at > ttlCutoff)
          .map((r) => r.ugc_video_id),
      );
      for (const id of slice) if (!recentlyEnriched.has(id)) idsToEnrich.push(id);
    }

    if (idsToEnrich.length > 0) {
      const batchErrors: Array<{ batch_start: number; status: number; message: string }> = [];
      const enrichment = await enrichUGCVideos(
        idsToEnrich,
        env.YOUTUBE_API_KEY,
        batchErrors,
      );
      enrichedCount = enrichment.size;
      if (batchErrors.length > 0) {
        // Surface YT API failures (quota, key rejected, etc.) to ops_error_log
        // so future runs are diagnosable instead of silently returning 0.
        await supabase.from('ops_error_log').insert({
          error_type: 'ugc_enrichment_batch_failed',
          error_message: `${batchErrors.length} batch(es) failed during videos.list enrichment`,
          detail: { batch_errors: batchErrors, requested: idsToEnrich.length, succeeded: enrichment.size },
          ingest_run_id: runId,
        });
      }
      const nowIso = new Date().toISOString();
      const dimRows = Array.from(enrichment.values()).map((e) => ({
        ugc_video_id: e.ugc_video_id,
        channel_id: e.channel_id,
        channel_name: e.channel_name,
        title: e.title,
        description: e.description,
        published_at: e.published_at,
        duration_seconds: e.duration_seconds,
        is_short: e.is_short,
        licensed_content: e.licensed_content,
        latest_view_count: e.view_count,
        latest_like_count: e.like_count,
        latest_comment_count: e.comment_count,
        enriched_at: nowIso,
      }));
      for (let i = 0; i < dimRows.length; i += 200) {
        await supabase
          .from('dim_ugc_video')
          .upsert(dimRows.slice(i, i + 200), { onConflict: 'ugc_video_id' });
      }
      // NOTE: per-snapshot views_exact backfill on fct_ugc_short_match is
      // deliberately skipped — would need 425 individual UPDATEs per run
      // (~21s), bumping us close to maxDuration. The precise view count
      // already lives in dim_ugc_video.latest_view_count. If we need a
      // per-snapshot precise series later, add a SECURITY DEFINER
      // postgres function that bulk-updates via jsonb_to_recordset.
    }
  }

  // ---- I3: Sampled music-panel attribution check ---------------------
  // For the highest-view UGC Shorts where attribution hasn't been checked
  // recently, fetch the watch page and classify the attribution kind.
  //
  // We rank candidates by view_count from fct_ugc_short_match (always
  // present) rather than dim_ugc_video.latest_view_count (may be NULL if
  // enrichment is degraded today) — so attribution runs even when
  // enrichment fails.
  if (ugcIds.length > 0) {
    const ttlCutoff = new Date(
      Date.now() - ENRICHMENT_TTL_DAYS * 86_400_000,
    ).toISOString();

    // Build candidate queue ordered by approximate view_count from this
    // snapshot. Skip ones we've already checked recently.
    const { data: ugcViews } = await supabase
      .from('fct_ugc_short_match')
      .select('ugc_video_id, view_count')
      .eq('asof', today)
      .in(
        'source_video_id',
        anchors.map((a) => a.video_id),
      );
    const viewByUgc = new Map<string, number>();
    for (const r of (ugcViews ?? []) as Array<{
      ugc_video_id: string;
      view_count: number | null;
    }>) {
      const cur = viewByUgc.get(r.ugc_video_id) ?? 0;
      viewByUgc.set(r.ugc_video_id, Math.max(cur, r.view_count ?? 0));
    }

    const { data: already } = await supabase
      .from('dim_ugc_video')
      .select('ugc_video_id, attribution_checked_at')
      .in('ugc_video_id', ugcIds);
    const recentlyChecked = new Set(
      ((already ?? []) as Array<{
        ugc_video_id: string;
        attribution_checked_at: string | null;
      }>)
        .filter((r) => r.attribution_checked_at != null && r.attribution_checked_at > ttlCutoff)
        .map((r) => r.ugc_video_id),
    );

    const queue = ugcIds
      .filter((id) => !recentlyChecked.has(id))
      .sort((a, b) => (viewByUgc.get(b) ?? 0) - (viewByUgc.get(a) ?? 0))
      .slice(0, ATTRIBUTION_SAMPLE_SIZE);

    for (const ugcId of queue) {
      try {
        const att = await fetchMusicAttribution(ugcId);
        await supabase
          .from('dim_ugc_video')
          .upsert(
            {
              ugc_video_id: ugcId,
              attribution_kind: att.kind,
              attribution_label: att.label,
              attribution_song: att.song,
              attribution_artist: att.artist,
              attribution_source_video_id: att.source_video_id,
              attribution_checked_at: new Date().toISOString(),
            },
            { onConflict: 'ugc_video_id' },
          );
        attributionChecked += 1;
        attributionCounts[att.kind] = (attributionCounts[att.kind] ?? 0) + 1;
      } catch {
        // Individual failures don't fail the cron
      }
      await new Promise((r) => setTimeout(r, ATTRIBUTION_DELAY_MS));
    }
  }

  // ---- Resolve source-audio channel ownership ----------------------------
  // attribution_source_video_id is the master audio that YT's Content ID
  // matched against. It's almost never in dim_video (masters live on
  // Topic / audio-only channels). Batch-resolve channel info via
  // videos.list so a downstream JOIN against dim_channel can determine
  // whether the source is ours.
  let sourceChannelsResolved = 0;
  if (env.YOUTUBE_API_KEY) {
    // Distinct source video ids that we haven't yet resolved
    const { data: pending } = await supabase
      .from('dim_ugc_video')
      .select('attribution_source_video_id')
      .not('attribution_source_video_id', 'is', null)
      .is('attribution_source_channel_id', null)
      .limit(2000);
    const sourceIds = Array.from(
      new Set(
        ((pending ?? []) as Array<{ attribution_source_video_id: string }>)
          .map((r) => r.attribution_source_video_id)
          .filter(Boolean),
      ),
    );
    if (sourceIds.length > 0) {
      const resolved = await resolveVideoChannels(sourceIds, env.YOUTUBE_API_KEY);
      // For each resolved source video, update every dim_ugc_video row that
      // points at it
      for (const [sourceVid, info] of resolved) {
        if (info.channel_id == null) continue;
        await supabase
          .from('dim_ugc_video')
          .update({
            attribution_source_channel_id: info.channel_id,
            attribution_source_channel_name: info.channel_name,
          })
          .eq('attribution_source_video_id', sourceVid);
        sourceChannelsResolved += 1;
      }
    }
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
    enriched_videos: enrichedCount,
    attribution_checked: attributionChecked,
    attribution_breakdown: attributionCounts,
    source_channels_resolved: sourceChannelsResolved,
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
    enriched_videos: enrichedCount,
    attribution_checked: attributionChecked,
    attribution_breakdown: attributionCounts,
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
