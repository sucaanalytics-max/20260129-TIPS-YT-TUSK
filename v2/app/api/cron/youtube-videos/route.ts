import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchUploadIds, fetchVideos } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily per-video ingest.
 *
 * Strategy: for each active channel with a known uploads_playlist_id, walk the
 * uploads playlist for the most recent N videos (default 50), then videos.list
 * to fetch statistics. Inserts into dim_video (upsert) and fct_video_daily.
 *
 * Quota cost: per channel = 1 (playlistItems) + 1 (videos.list). With 38 channels
 * that's ~76 units/day. Comfortably inside the 10k/day budget.
 */
const RECENT_UPLOADS_PER_CHANNEL = 50;

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'youtube_videos', status: 'running' })
    .select('run_id')
    .single();
  const runId = runRow?.run_id as string | undefined;
  if (!runId) return NextResponse.json({ ok: false, error: 'could not open run' }, { status: 500 });

  try {
    const { data: channels, error: chErr } = await supabase
      .from('dim_channel')
      .select('channel_id, uploads_playlist_id, channel_name')
      .eq('is_active', true)
      .not('uploads_playlist_id', 'is', null);
    if (chErr) throw new Error(chErr.message);
    if (!channels?.length) {
      await closeRun(supabase, runId, 'ok', 0, 0, { note: 'no channels with uploads_playlist_id' });
      return NextResponse.json({ ok: true, channels: 0 });
    }

    let videosUpserted = 0;
    let factsUpserted = 0;
    const errors: { channel_id: string; error: string }[] = [];

    for (const ch of channels) {
      try {
        const uploads = await fetchUploadIds(ch.uploads_playlist_id!, RECENT_UPLOADS_PER_CHANNEL);
        if (!uploads.length) continue;
        const videoIds = uploads.map((u) => u.videoId);
        const videos = await fetchVideos(videoIds);

        // dim_video upsert (one row per video; created or refreshed)
        const dimRows = videos.map((v) => ({
          video_id: v.id,
          channel_id: v.snippet.channelId,
          title: v.snippet.title,
          description: v.snippet.description ?? null,
          published_at: v.snippet.publishedAt,
          duration_seconds: parseDurationSeconds(v.contentDetails?.duration),
          is_short: isShort(v.contentDetails?.duration),
          category_id: v.snippet.categoryId ?? null,
          language: v.snippet.defaultLanguage ?? v.snippet.defaultAudioLanguage ?? null,
          tags: v.snippet.tags ?? null,
          updated_at: new Date().toISOString(),
        }));
        const { error: dimErr } = await supabase
          .from('dim_video')
          .upsert(dimRows, { onConflict: 'video_id' });
        if (dimErr) throw new Error(`dim_video: ${dimErr.message}`);
        videosUpserted += dimRows.length;

        // Prior video views for delta math (today's run's prior is yesterday's facts)
        const { data: priorRows } = await supabase
          .from('fct_video_daily')
          .select('video_id, date, views')
          .in('video_id', videoIds)
          .gte('date', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
          .lt('date', today)
          .order('date', { ascending: false });
        const priorBy = new Map<string, { date: string; views: number }>();
        for (const r of priorRows ?? []) {
          if (!priorBy.has(r.video_id)) {
            priorBy.set(r.video_id, { date: r.date, views: Number(r.views ?? 0) });
          }
        }

        const factRows = videos.map((v) => {
          const views = v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null;
          const prior = priorBy.get(v.id);
          let daily_views: number | null = null;
          if (views != null && prior && diffDays(today, prior.date) === 1) {
            const dv = views - prior.views;
            if (dv >= 0 && dv <= 200_000_000) daily_views = dv;
          }
          return {
            video_id: v.id,
            date: today,
            views,
            likes: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
            comments: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
            daily_views,
            ingest_run_id: runId,
          };
        });

        const { error: factErr } = await supabase
          .from('fct_video_daily')
          .upsert(factRows, { onConflict: 'video_id,date' });
        if (factErr) throw new Error(`fct_video_daily: ${factErr.message}`);
        factsUpserted += factRows.length;
      } catch (e) {
        errors.push({ channel_id: ch.channel_id, error: (e as Error).message });
      }
    }

    const status = errors.length ? 'partial' : 'ok';
    await closeRun(supabase, runId, status, channels.length, videosUpserted, {
      videos_upserted: videosUpserted,
      facts_upserted: factsUpserted,
      errors,
    });
    return NextResponse.json({
      ok: true,
      run_id: runId,
      videos_upserted: videosUpserted,
      facts_upserted: factsUpserted,
      errors: errors.length,
    });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'youtube_videos_ingest_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await closeRun(supabase, runId, 'failed', null, null, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function diffDays(today: string, prior: string): number {
  return Math.round(
    (new Date(today + 'T00:00:00Z').getTime() - new Date(prior + 'T00:00:00Z').getTime()) /
      86_400_000,
  );
}

function parseDurationSeconds(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h = '0', mi = '0', s = '0'] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s);
}

function isShort(iso?: string): boolean | null {
  const s = parseDurationSeconds(iso);
  if (s == null) return null;
  return s <= 60;
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
