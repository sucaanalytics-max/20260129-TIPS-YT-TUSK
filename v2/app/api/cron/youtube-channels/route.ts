import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchChannels, type YTChannel } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Daily YT Data API v3 ingest for all active dim_channel rows.
 *
 * Quota cost: ceil(N / 50) units per run. With 38 channels: 1 unit/day.
 * Default key quota is 10,000 units/day, so this is < 0.01% utilisation.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const runStart = new Date();

  // Open audit run
  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'youtube_channels', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as string;

  try {
    // 1) Active channels
    const { data: channels, error: chErr } = await supabase
      .from('dim_channel')
      .select('channel_id, channel_name')
      .eq('is_active', true);
    if (chErr) throw new Error(`dim_channel query: ${chErr.message}`);
    if (!channels?.length) {
      await closeRun(supabase, runId, 'ok', 0, 0, { note: 'no active channels' });
      return NextResponse.json({ ok: true, channels: 0 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    // 2) Prior rows for delta math
    const { data: priorRows } = await supabase
      .from('fct_channel_daily')
      .select('channel_id, date, total_views, subscribers, video_count')
      .gte('date', sevenDaysAgo)
      .lt('date', today)
      .order('date', { ascending: false });

    const priorBy = new Map<
      string,
      { date: string; total_views: number; subscribers: number; video_count: number }
    >();
    for (const r of priorRows ?? []) {
      if (!priorBy.has(r.channel_id)) {
        priorBy.set(r.channel_id, {
          date: r.date,
          total_views: Number(r.total_views ?? 0),
          subscribers: Number(r.subscribers ?? 0),
          video_count: Number(r.video_count ?? 0),
        });
      }
    }

    // 3) YT Data API v3 batch call (up to 50 ids per request)
    const ytItems = await fetchChannels(channels.map((c) => c.channel_id));

    // Retain the raw payload (one row for the whole call)
    await supabase.from('raw_youtube_api').insert({
      endpoint: 'channels.list',
      request_params: { ids: channels.map((c) => c.channel_id) },
      response_payload: ytItems,
      ingest_run_id: runId,
    });

    const ytById = new Map(ytItems.map((i: YTChannel) => [i.id, i]));

    // 4) Build upsert records
    const facts: Record<string, unknown>[] = [];
    const channelDimUpdates: Record<string, unknown>[] = [];
    const missing: string[] = [];

    for (const ch of channels) {
      const it = ytById.get(ch.channel_id);
      if (!it) {
        missing.push(ch.channel_id);
        continue;
      }
      const s = it.statistics ?? {};
      const total_views = s.viewCount != null ? Number(s.viewCount) : null;
      const subscribers = s.hiddenSubscriberCount
        ? null
        : s.subscriberCount != null
          ? Number(s.subscriberCount)
          : null;
      const video_count = s.videoCount != null ? Number(s.videoCount) : null;

      const prior = priorBy.get(ch.channel_id);
      let daily_views: number | null = null;
      let daily_subscribers: number | null = null;
      let daily_videos: number | null = null;
      if (prior && diffDays(today, prior.date) === 1) {
        if (total_views != null) {
          const dv = total_views - prior.total_views;
          if (dv >= 0 && dv <= 200_000_000) daily_views = dv;
        }
        if (subscribers != null) {
          const ds = subscribers - prior.subscribers;
          if (ds >= -100_000 && ds <= 1_000_000) daily_subscribers = ds;
        }
        if (video_count != null) {
          const dvd = video_count - prior.video_count;
          if (dvd >= -100 && dvd <= 10_000) daily_videos = dvd;
        }
      }

      facts.push({
        channel_id: ch.channel_id,
        date: today,
        total_views,
        subscribers,
        video_count,
        daily_views,
        daily_subscribers,
        daily_videos,
        ingest_run_id: runId,
      });

      // Opportunistic: keep dim_channel.uploads_playlist_id fresh.
      const uploads = it.contentDetails?.relatedPlaylists?.uploads;
      if (uploads) {
        channelDimUpdates.push({
          channel_id: ch.channel_id,
          uploads_playlist_id: uploads,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 5) Chunked upsert into fct_channel_daily
    let upserted = 0;
    const failed: { channel_id: string; error: string }[] = [];
    for (let i = 0; i < facts.length; i += 25) {
      const chunk = facts.slice(i, i + 25);
      const { error } = await supabase
        .from('fct_channel_daily')
        .upsert(chunk, { onConflict: 'channel_id,date' });
      if (error) {
        failed.push(
          ...chunk.map((r) => ({
            channel_id: r.channel_id as string,
            error: error.message,
          })),
        );
      } else {
        upserted += chunk.length;
      }
    }

    // 6) Refresh dim_channel.uploads_playlist_id
    if (channelDimUpdates.length) {
      await supabase.from('dim_channel').upsert(channelDimUpdates, { onConflict: 'channel_id' });
    }

    const status = failed.length || missing.length ? 'partial' : 'ok';
    await closeRun(supabase, runId, status, channels.length, upserted, {
      missing,
      failed,
      quota_units: Math.ceil(channels.length / 50),
      duration_ms: Date.now() - runStart.getTime(),
    });

    return NextResponse.json({
      ok: true,
      run_id: runId,
      date: today,
      channels: channels.length,
      upserted,
      missing: missing.length,
      failed: failed.length,
    });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'youtube_channels_ingest_failed',
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
