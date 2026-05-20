import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchUploadIds, fetchVideos } from '@/lib/youtube';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

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
      .eq('ingest_videos', true)
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
        const dimRows = videos.map((v) => {
          const live = v.liveStreamingDetails;
          // Merge topicDetails.topicIds + relevantTopicIds (deduped).
          const tIds = new Set<string>([
            ...(v.topicDetails?.topicIds ?? []),
            ...(v.topicDetails?.relevantTopicIds ?? []),
          ]);
          const concurrent =
            live?.concurrentViewers != null ? Number(live.concurrentViewers) : null;
          return {
            video_id: v.id,
            channel_id: v.snippet.channelId,
            title: v.snippet.title,
            description: v.snippet.description ?? null,
            published_at: v.snippet.publishedAt,
            duration_seconds: parseDurationSeconds(v.contentDetails?.duration),
            // is_short is NOT NULL in schema with default false; coerce missing
            // duration to false rather than sending null which overrides default.
            is_short: isShort(v.contentDetails?.duration) ?? false,
            category_id: v.snippet.categoryId ?? null,
            language: v.snippet.defaultLanguage ?? v.snippet.defaultAudioLanguage ?? null,
            tags: v.snippet.tags ?? null,
            // Topics: opaque entity IDs + human-readable Wikipedia categories
            topic_ids: tIds.size > 0 ? Array.from(tIds) : null,
            topic_categories: v.topicDetails?.topicCategories ?? null,
            // Live-streaming metadata
            is_live: live?.actualStartTime != null,
            actual_start_time: live?.actualStartTime ?? null,
            actual_end_time: live?.actualEndTime ?? null,
            scheduled_start_time: live?.scheduledStartTime ?? null,
            peak_concurrent_viewers: concurrent != null && Number.isFinite(concurrent) ? concurrent : null,
            // Compliance
            made_for_kids:
              v.status?.madeForKids ?? v.status?.selfDeclaredMadeForKids ?? null,
            updated_at: new Date().toISOString(),
          };
        });
        const { error: dimErr } = await supabase
          .from('dim_video')
          .upsert(dimRows, { onConflict: 'video_id' });
        if (dimErr) throw new Error(`dim_video: ${dimErr.message}`);
        videosUpserted += dimRows.length;

        // Emit dim_event 'release' rows for the event-study pipeline. Idempotent
        // via uq_dim_event_video (event_type='release', video_id).
        const eventRows = videos.map((v) => ({
          event_type: 'release',
          event_date: v.snippet.publishedAt.slice(0, 10),
          label: v.snippet.title.slice(0, 200),
          channel_id: v.snippet.channelId,
          video_id: v.id,
          meta: {
            duration_seconds: parseDurationSeconds(v.contentDetails?.duration),
            is_short: isShort(v.contentDetails?.duration),
            language: v.snippet.defaultLanguage ?? v.snippet.defaultAudioLanguage ?? null,
          },
        }));
        await supabase
          .from('dim_event')
          .upsert(eventRows, { onConflict: 'event_type,video_id', ignoreDuplicates: false });

        // Emit 'live_premiere' events for completed live broadcasts. These have
        // different abnormal-return profiles than catalog releases and need to
        // be studied separately by the event-study pipeline. Keyed by video_id
        // (same uq_dim_event_video index) so re-runs are idempotent.
        const premiereRows = videos
          .filter((v) => v.liveStreamingDetails?.actualStartTime != null)
          .map((v) => {
            const live = v.liveStreamingDetails!;
            const concurrent =
              live.concurrentViewers != null ? Number(live.concurrentViewers) : null;
            return {
              event_type: 'live_premiere',
              event_date: (live.actualStartTime ?? v.snippet.publishedAt).slice(0, 10),
              label: v.snippet.title.slice(0, 200),
              channel_id: v.snippet.channelId,
              video_id: v.id,
              meta: {
                actual_start_time: live.actualStartTime,
                actual_end_time: live.actualEndTime ?? null,
                scheduled_start_time: live.scheduledStartTime ?? null,
                peak_concurrent_viewers:
                  concurrent != null && Number.isFinite(concurrent) ? concurrent : null,
                duration_seconds: parseDurationSeconds(v.contentDetails?.duration),
              },
            };
          });
        if (premiereRows.length > 0) {
          await supabase
            .from('dim_event')
            .upsert(premiereRows, {
              onConflict: 'event_type,video_id',
              ignoreDuplicates: false,
            });
        }

        // Prior video stats for delta math (today's run's prior is yesterday's facts).
        // Pull views/likes/comments together so all three deltas use the same
        // anchor day — keeps engagement ratios self-consistent.
        const { data: priorRows } = await supabase
          .from('fct_video_daily')
          .select('video_id, date, views, likes, comments')
          .in('video_id', videoIds)
          .gte('date', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
          .lt('date', today)
          .order('date', { ascending: false });
        const priorBy = new Map<
          string,
          { date: string; views: number; likes: number | null; comments: number | null }
        >();
        for (const r of priorRows ?? []) {
          if (!priorBy.has(r.video_id)) {
            priorBy.set(r.video_id, {
              date: r.date,
              views: Number(r.views ?? 0),
              likes: r.likes != null ? Number(r.likes) : null,
              comments: r.comments != null ? Number(r.comments) : null,
            });
          }
        }

        const factRows = videos.map((v) => {
          const views = v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null;
          const likes = v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null;
          const comments =
            v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null;
          const prior = priorBy.get(v.id);
          const oneDayPrior = prior != null && diffDays(today, prior.date) === 1;
          let daily_views: number | null = null;
          let daily_likes: number | null = null;
          let daily_comments: number | null = null;
          if (oneDayPrior && views != null && prior) {
            const dv = views - prior.views;
            if (dv >= 0 && dv <= 200_000_000) daily_views = dv;
          }
          // Likes / comments can have negative deltas (moderation, spam
          // removal). Allow them, but cap absolute magnitude to filter
          // sensor-glitch outliers.
          if (oneDayPrior && likes != null && prior && prior.likes != null) {
            const dl = likes - prior.likes;
            if (Math.abs(dl) <= 50_000_000) daily_likes = dl;
          }
          if (oneDayPrior && comments != null && prior && prior.comments != null) {
            const dc = comments - prior.comments;
            if (Math.abs(dc) <= 10_000_000) daily_comments = dc;
          }
          return {
            video_id: v.id,
            date: today,
            views,
            likes,
            comments,
            daily_views,
            daily_likes,
            daily_comments,
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

    if (videosUpserted > 0 || factsUpserted > 0) {
      bumpTags(CACHE_TAGS.videos, CACHE_TAGS.events, CACHE_TAGS.overview, CACHE_TAGS.ops);
    }

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
