import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import {
  fetchShortsForSoundDetailed,
  enrichUGCVideos,
  fetchMusicAttribution,
  type ShortMatch,
} from '@/lib/youtube-ugc';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';
import { env } from '@/lib/env';

export const maxDuration = 300;

/**
 * UGC sweep WORKER (cursor-batched discovery, step 2 of 2).
 *
 * Each tick:
 *   1. drains a bounded SLICE of pending anchors from ugc_discovery_queue,
 *      scraping the Shorts pivot (exhausting continuation) and upserting
 *      matches into fct_ugc_short_match; marks each anchor done/error.
 *   2. runs a bounded enrichment pass (videos.list → channel_id, exact views,
 *      views_exact backfill) + a small attribution sample over this sweep's
 *      UGC, reusing the TTL guards.
 *
 * Both passes are bounded so a tick always finishes under the 300s cap. A
 * failed anchor simply retries next tick (idempotent upserts). Scheduled to
 * run repeatedly across the sweep window until the queue drains (vercel.json).
 *
 * NOTE: creator-geo + source-channel resolution (revenue catalog-match
 * enhancements, not needed for the reach headline) are not yet ported here —
 * follow-up drain. Reach + first-party exclusion only need channel_id + exact
 * views, which the enrichment pass provides.
 */

// Per anchor at PIVOT_PAGES=10: 1 initial GET + up to 9 continuation POSTs
// (~1s each) + SCRAPE_DELAY_MS ≈ up to ~11.5s worst case. The SCRAPE_DEADLINE_MS
// wall-clock guard below — NOT SLICE_SIZE alone — is what keeps a tick under
// Vercel's 300s hard cap; SLICE_SIZE is just an upper bound per tick.
const SLICE_SIZE = 15; // ≤15 × ~11.5s ≈ 172s worst case, leaving room for the drains
const PIVOT_PAGES = 10; // exhaust pivot continuation (old route used 3)
const SCRAPE_DELAY_MS = 1500; // politeness between anchor scrapes
const MAX_ATTEMPTS = 3;
const ENRICH_BATCH = 200; // videos.list ids enriched per tick
const ENRICHMENT_TTL_DAYS = 14;
const ATTRIBUTION_SAMPLE = 25; // watch-page attribution checks per tick
const ATTRIBUTION_DELAY_MS = 800;
// Wall-clock budgets against the 300s hard cap. Stop scraping NEW anchors past
// SCRAPE_DEADLINE_MS (remaining anchors retry next tick); skip the attribution
// drain entirely once past ATTRIBUTION_DEADLINE_MS so a tick never overruns.
const SCRAPE_DEADLINE_MS = 210_000;
const ATTRIBUTION_DEADLINE_MS = 250_000;

type SB = ReturnType<typeof getServiceSupabase>;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const tickStart = Date.now();

  // Self-heal genuinely stale runs only. The age filter (310s > the 300s hard
  // cap) guarantees we never mark a still-live sibling tick failed — only runs
  // a previous invocation left orphaned by a timeout kill.
  await supabase
    .from('ops_ingest_run')
    .update({
      status: 'failed',
      ended_at: new Date().toISOString(),
      detail: { note: 'auto-closed: stale running run' },
    })
    .eq('source', 'ugc_work')
    .eq('status', 'running')
    .lt('started_at', new Date(tickStart - 310_000).toISOString());

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'ugc_work', status: 'running' })
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
    // Target the most recent sweep that still has pending anchors.
    const { data: pend } = await supabase
      .from('ugc_discovery_queue')
      .select('sweep_date')
      .eq('status', 'pending')
      .order('sweep_date', { ascending: false })
      .limit(1);
    const sweepDate = (pend?.[0] as { sweep_date: string } | undefined)?.sweep_date ?? null;

    let drained = 0;
    let totalMatches = 0;
    let truncatedCount = 0;

    if (sweepDate) {
      const { data: slice } = await supabase
        .from('ugc_discovery_queue')
        .select('source_video_id, attempts')
        .eq('sweep_date', sweepDate)
        .eq('status', 'pending')
        .order('attempts', { ascending: true })
        .limit(SLICE_SIZE);
      const anchors = (slice ?? []) as Array<{ source_video_id: string; attempts: number }>;

      let zeroMatch = 0;
      for (const a of anchors) {
        // Wall-clock guard: stop taking new anchors near the budget so the
        // enrich + attribution drains still fit under the 300s cap. Unprocessed
        // anchors stay 'pending' (attempts unchanged) and retry next tick.
        if (Date.now() - tickStart > SCRAPE_DEADLINE_MS) break;
        try {
          const { matches, truncated } = await fetchShortsForSoundDetailed(
            a.source_video_id,
            PIVOT_PAGES,
          );
          if (matches.length > 0) {
            const rows = matches.map((m: ShortMatch) => ({
              source_video_id: a.source_video_id,
              ugc_video_id: m.ugc_video_id,
              asof: sweepDate,
              view_count: m.view_count,
              view_count_text: m.view_count_text,
              channel_name: m.channel_name,
              raw_meta: m.raw_meta,
              ingest_run_id: runId,
            }));
            for (let i = 0; i < rows.length; i += 200) {
              const { error } = await supabase
                .from('fct_ugc_short_match')
                .upsert(rows.slice(i, i + 200), {
                  onConflict: 'source_video_id,ugc_video_id,asof',
                });
              if (error) throw new Error(`upsert matches: ${error.message}`);
            }
          }
          await supabase
            .from('ugc_discovery_queue')
            .update({
              status: 'done',
              matches: matches.length,
              truncated,
              processed_at: new Date().toISOString(),
            })
            .eq('sweep_date', sweepDate)
            .eq('source_video_id', a.source_video_id);
          drained += 1;
          totalMatches += matches.length;
          if (truncated) truncatedCount += 1;
          if (matches.length === 0) zeroMatch += 1;
        } catch (e) {
          const attempts = (a.attempts ?? 0) + 1;
          await supabase
            .from('ugc_discovery_queue')
            .update({
              attempts,
              status: attempts >= MAX_ATTEMPTS ? 'error' : 'pending',
              error: (e as Error).message,
            })
            .eq('sweep_date', sweepDate)
            .eq('source_video_id', a.source_video_id);
        }
        await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS));
      }

      // Soft-block detection: a healthy sweep rarely returns 0 Shorts for most
      // anchors. A spike of zero-match anchors usually means YouTube is
      // soft-blocking the scrape (empty 200s / CAPTCHA) — surface it rather than
      // silently closing a clean 'ok' run with collapsed reach.
      if (drained >= 5 && zeroMatch / drained > 0.6) {
        await supabase.from('ops_error_log').insert({
          error_type: 'ugc_discovery_zero_match_spike',
          error_message: `${zeroMatch}/${drained} anchors returned 0 Shorts — possible scrape soft-block`,
          detail: { sweep_date: sweepDate, drained, zero_match: zeroMatch },
          ingest_run_id: runId,
        });
      }
    }

    // Bounded enrichment + attribution over this sweep's discovered UGC.
    const enrichSweep = sweepDate ?? new Date().toISOString().slice(0, 10);
    const enriched = await enrichDrain(supabase, enrichSweep);
    // Skip attribution if we're already near the cap (scrape ran long); it
    // catches up on a lighter tick. enrich is cheap so it always runs.
    const attributed =
      Date.now() - tickStart < ATTRIBUTION_DEADLINE_MS
        ? await attributionDrain(supabase, enrichSweep)
        : 0;

    if (totalMatches > 0 || enriched > 0 || attributed > 0) {
      bumpTags(CACHE_TAGS.signals, CACHE_TAGS.overview, CACHE_TAGS.ops);
    }

    let remaining: number | null = null;
    if (sweepDate) {
      const { count } = await supabase
        .from('ugc_discovery_queue')
        .select('*', { count: 'exact', head: true })
        .eq('sweep_date', sweepDate)
        .eq('status', 'pending');
      remaining = count ?? null;
    }

    await closeRun(supabase, runId, 'ok', {
      sweep_date: sweepDate,
      drained,
      total_matches: totalMatches,
      truncated: truncatedCount,
      enriched,
      attributed,
      remaining,
    });
    return NextResponse.json({
      ok: true,
      run_id: runId,
      sweep_date: sweepDate,
      drained,
      total_matches: totalMatches,
      truncated: truncatedCount,
      enriched,
      attributed,
      remaining,
    });
  } catch (err) {
    const message = (err as Error).message;
    await closeRun(supabase, runId, 'failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Enrich (videos.list) UGC ids from this sweep that haven't been enriched
 * within the TTL: resolves channel_id (for first-party exclusion), exact
 * cumulative views, is_short/licensed, then backfills views_exact onto the
 * snapshot rows. Bounded to ENRICH_BATCH ids per tick.
 */
async function enrichDrain(supabase: SB, sweepDate: string): Promise<number> {
  if (!env.YOUTUBE_API_KEY) return 0;

  // Pull this sweep's distinct ugc ids in deterministic (ascending) order,
  // paginated. An unordered .limit(5000) re-scans the same heap-order head every
  // tick and never reaches the tail at 361-anchor scale (tens of thousands of
  // match rows), so tail UGC never gets exact views. Ordering + the TTL filter
  // below advances the enrichment frontier across ticks. (Ideal future fix: a
  // single anti-join RPC fetching only not-yet-enriched ids.)
  const idSet = new Set<string>();
  const PAGE = 1000;
  const MAX_PAGES = 30; // safety bound (~30k raw match rows/sweep)
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data: page } = await supabase
      .from('fct_ugc_short_match')
      .select('ugc_video_id')
      .eq('asof', sweepDate)
      .order('ugc_video_id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    const batch = (page ?? []) as Array<{ ugc_video_id: string }>;
    for (const r of batch) idSet.add(r.ugc_video_id);
    if (batch.length < PAGE) break;
  }
  const ids = [...idSet];
  if (ids.length === 0) return 0;

  const ttlCutoff = new Date(Date.now() - ENRICHMENT_TTL_DAYS * 86_400_000).toISOString();
  const toEnrich: string[] = [];
  for (let i = 0; i < ids.length && toEnrich.length < ENRICH_BATCH; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data: existing } = await supabase
      .from('dim_ugc_video')
      .select('ugc_video_id, enriched_at')
      .in('ugc_video_id', slice);
    const recent = new Set(
      ((existing ?? []) as Array<{ ugc_video_id: string; enriched_at: string | null }>)
        .filter((r) => r.enriched_at != null && r.enriched_at > ttlCutoff)
        .map((r) => r.ugc_video_id),
    );
    for (const id of slice) if (!recent.has(id)) toEnrich.push(id);
  }
  const batch = toEnrich.slice(0, ENRICH_BATCH);
  if (batch.length === 0) return 0;

  const errors: Array<{ batch_start: number; status: number; message: string }> = [];
  const enrichment = await enrichUGCVideos(batch, env.YOUTUBE_API_KEY, errors);
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
  let upsertErrors = 0;
  for (let i = 0; i < dimRows.length; i += 200) {
    const { error: upErr } = await supabase
      .from('dim_ugc_video')
      .upsert(dimRows.slice(i, i + 200), { onConflict: 'ugc_video_id' });
    if (upErr) upsertErrors += 1;
  }
  // Backfill precise counts onto this sweep's snapshot rows in one round-trip.
  const exactRows = dimRows
    .filter((d) => d.latest_view_count != null)
    .map((d) => ({ ugc_video_id: d.ugc_video_id, views: Number(d.latest_view_count) }));
  let rpcError: string | null = null;
  if (exactRows.length > 0) {
    const { error: rpcErr } = await supabase.rpc('update_ugc_views_exact', {
      p_asof: sweepDate,
      p_rows: exactRows,
    });
    if (rpcErr) rpcError = rpcErr.message;
  }
  // Surface write-side + videos.list batch failures instead of silently
  // reporting enriched=N with nothing persisted (matches the old route).
  if (errors.length > 0 || upsertErrors > 0 || rpcError) {
    await supabase.from('ops_error_log').insert({
      error_type: 'ugc_enrich_partial_failure',
      error_message:
        `enrich issues: ${errors.length} videos.list batch error(s), ` +
        `${upsertErrors} dim_ugc_video upsert error(s)` +
        (rpcError ? `, views_exact RPC: ${rpcError}` : ''),
      detail: {
        sweep_date: sweepDate,
        batch_errors: errors,
        upsert_errors: upsertErrors,
        rpc_error: rpcError,
      },
    });
  }
  return enrichment.size;
}

/**
 * Sampled music-panel attribution check for this sweep's highest-view UGC that
 * hasn't been checked within the TTL. Keeps the content_id confirmation signal
 * (used by the revenue catalog-match) fresh. Bounded to ATTRIBUTION_SAMPLE.
 */
async function attributionDrain(supabase: SB, sweepDate: string): Promise<number> {
  const { data: rows } = await supabase
    .from('fct_ugc_short_match')
    .select('ugc_video_id, view_count')
    .eq('asof', sweepDate)
    .limit(5000);
  const viewByUgc = new Map<string, number>();
  for (const r of (rows ?? []) as Array<{ ugc_video_id: string; view_count: number | null }>) {
    viewByUgc.set(r.ugc_video_id, Math.max(viewByUgc.get(r.ugc_video_id) ?? 0, r.view_count ?? 0));
  }
  const ids = [...viewByUgc.keys()];
  if (ids.length === 0) return 0;

  const ttlCutoff = new Date(Date.now() - ENRICHMENT_TTL_DAYS * 86_400_000).toISOString();
  const recentlyChecked = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data: already } = await supabase
      .from('dim_ugc_video')
      .select('ugc_video_id, attribution_checked_at')
      .in('ugc_video_id', slice);
    for (const r of (already ?? []) as Array<{
      ugc_video_id: string;
      attribution_checked_at: string | null;
    }>) {
      if (r.attribution_checked_at != null && r.attribution_checked_at > ttlCutoff) {
        recentlyChecked.add(r.ugc_video_id);
      }
    }
  }

  const queue = ids
    .filter((id) => !recentlyChecked.has(id))
    .sort((a, b) => (viewByUgc.get(b) ?? 0) - (viewByUgc.get(a) ?? 0))
    .slice(0, ATTRIBUTION_SAMPLE);

  let checked = 0;
  for (const ugcId of queue) {
    try {
      const att = await fetchMusicAttribution(ugcId);
      await supabase.from('dim_ugc_video').upsert(
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
      checked += 1;
    } catch {
      // individual failures don't fail the tick
    }
    await new Promise((r) => setTimeout(r, ATTRIBUTION_DELAY_MS));
  }
  return checked;
}

async function closeRun(
  supabase: SB,
  runId: number | undefined,
  status: 'ok' | 'failed',
  detail: Record<string, unknown>,
): Promise<void> {
  if (runId == null) return;
  await supabase
    .from('ops_ingest_run')
    .update({ status, ended_at: new Date().toISOString(), detail })
    .eq('run_id', runId);
}
