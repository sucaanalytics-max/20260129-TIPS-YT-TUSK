import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchChannels, type YTChannel } from '@/lib/youtube';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';
import { computeDailyViews, type DeltaPoint } from '@/lib/view-delta';

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
    // Wide enough to resolve a multi-day freeze in one pass. Observed stalls
    // have run to 32 days, so 45 leaves headroom without a costly scan.
    const windowStart = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);

    // 2) Prior rows for delta math. A window rather than just yesterday: when
    // YouTube serves a stale cumulative viewCount for several days and then
    // unfreezes, the catch-up has to be spread back over the days it actually
    // covers (see lib/view-delta.ts), which means re-deriving the recent series
    // rather than differencing a single pair of readings.
    const { data: priorRows } = await supabase
      .from('fct_channel_daily')
      .select('channel_id, date, total_views, subscribers, video_count, daily_views')
      .gte('date', windowStart)
      .lt('date', today)
      .order('date', { ascending: true });

    const priorBy = new Map<
      string,
      { date: string; total_views: number; subscribers: number; video_count: number }
    >();
    const seriesBy = new Map<
      string,
      Array<{ date: string; total_views: number | null; daily_views: number | null }>
    >();
    for (const r of priorRows ?? []) {
      // ascending, so the last write per channel is the most recent day
      priorBy.set(r.channel_id, {
        date: r.date,
        total_views: Number(r.total_views ?? 0),
        subscribers: Number(r.subscribers ?? 0),
        video_count: Number(r.video_count ?? 0),
      });
      const arr = seriesBy.get(r.channel_id) ?? [];
      arr.push({
        date: r.date,
        total_views: r.total_views == null ? null : Number(r.total_views),
        daily_views: r.daily_views == null ? null : Number(r.daily_views),
      });
      seriesBy.set(r.channel_id, arr);
    }

    // Rows whose daily_views changed once today's reading resolved a stall.
    const backfills: Record<string, unknown>[] = [];

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
      let daily_subscribers: number | null = null;
      let daily_videos: number | null = null;

      // Views: re-derive the whole recent series so a resolved freeze is spread
      // back across the days it covers instead of spiking on the catch-up day.
      const priorSeries = seriesBy.get(ch.channel_id) ?? [];
      const series: DeltaPoint[] = [
        ...priorSeries.map((p) => ({ date: p.date, total_views: p.total_views })),
        { date: today, total_views },
      ];
      const computed = computeDailyViews(series);
      const todayRow = computed[computed.length - 1];
      const daily_views = todayRow.daily_views;
      const daily_views_imputed = todayRow.imputed;
      const delta_span_days = todayRow.delta_span_days;

      // Where today's reading changed a prior day's value, correct it in place.
      for (let i = 0; i < computed.length - 1; i++) {
        const c = computed[i];
        const stored = priorSeries[i];
        if (!stored || c.daily_views === stored.daily_views) continue;
        backfills.push({
          channel_id: ch.channel_id,
          date: c.date,
          daily_views: c.daily_views,
          daily_views_imputed: c.imputed,
          delta_span_days: c.delta_span_days,
        });
      }

      if (prior && diffDays(today, prior.date) === 1) {
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
        daily_views_imputed,
        delta_span_days,
        daily_subscribers,
        daily_videos,
        ingest_run_id: runId,
      });

      // Opportunistic: keep dim_channel.uploads_playlist_id + status flags fresh.
      const uploads = it.contentDetails?.relatedPlaylists?.uploads;
      const made_for_kids =
        it.status?.madeForKids ?? it.status?.selfDeclaredMadeForKids ?? null;
      const privacy_status = it.status?.privacyStatus ?? null;
      if (uploads || made_for_kids != null || privacy_status != null) {
        const update: Record<string, unknown> = { channel_id: ch.channel_id };
        if (uploads) update.uploads_playlist_id = uploads;
        if (made_for_kids != null) update.made_for_kids = made_for_kids;
        if (privacy_status != null) update.privacy_status = privacy_status;
        channelDimUpdates.push(update);
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
      if (!error) {
        upserted += chunk.length;
        continue;
      }
      /*
       * A chunk is all-or-nothing, so one unacceptable row discards up to 24
       * good ones. That turned a handful of out-of-range deltas into a total
       * ingest outage: 71 rows offered, 0 written, every day for four days,
       * with the gap widening each run. Retry the chunk row by row so a bad row
       * costs one channel-day instead of the whole batch, and report the rows
       * that genuinely failed rather than tarring the chunk with them.
       */
      for (const row of chunk) {
        const { error: rowError } = await supabase
          .from('fct_channel_daily')
          .upsert(row, { onConflict: 'channel_id,date' });
        if (rowError) {
          failed.push({ channel_id: row.channel_id as string, error: rowError.message });
        } else {
          upserted += 1;
        }
      }
    }

    // 5b) Apply corrections to prior days that today's reading resolved. These
    // are deliberately separate from the main upsert: a failure here must not
    // lose today's data, and it is self-healing anyway — the next run re-derives
    // the same window and will retry.
    let corrected = 0;
    for (let i = 0; i < backfills.length; i += 25) {
      const chunk = backfills.slice(i, i + 25);
      const { error } = await supabase
        .from('fct_channel_daily')
        .upsert(chunk, { onConflict: 'channel_id,date' });
      if (error) {
        await supabase.from('ops_error_log').insert({
          error_type: 'channels_delta_backfill_failed',
          error_message: error.message,
          detail: { sample: chunk.slice(0, 3) },
          ingest_run_id: runId,
        });
      } else {
        corrected += chunk.length;
      }
    }

    // 6) Refresh dim_channel.uploads_playlist_id
    if (channelDimUpdates.length) {
      const { error: dimUpErr } = await supabase
        .from('dim_channel')
        .upsert(channelDimUpdates, { onConflict: 'channel_id' });
      if (dimUpErr) {
        // Don't fail the whole run; surface to ops_error_log so the next
        // /api/cron/youtube-videos still has the prior playlist IDs.
        await supabase.from('ops_error_log').insert({
          error_type: 'channels_dim_upsert_failed',
          error_message: dimUpErr.message,
          detail: { sample: channelDimUpdates.slice(0, 3) },
          ingest_run_id: runId,
        });
      }
    }

    const status = failed.length || missing.length ? 'partial' : 'ok';
    await closeRun(supabase, runId, status, channels.length, upserted, {
      missing,
      failed,
      quota_units: Math.ceil(channels.length / 50),
      duration_ms: Date.now() - runStart.getTime(),
      // Non-zero means YouTube served a stale cumulative viewCount and today's
      // reading resolved it; the backlog was spread over the days it covered.
      delta_corrections: corrected,
      frozen_today: facts.filter((f) => f.daily_views == null).length,
    });

    if (upserted > 0) bumpTags(CACHE_TAGS.overview, CACHE_TAGS.channels, CACHE_TAGS.ops);

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
