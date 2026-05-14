/**
 * Daily cron: fetches channel-level stats from YouTube Data API v3 for every
 * active channel in youtube_channels, computes deltas vs the prior row, and
 * upserts into youtube_channel_stats. Replaces the old Social Blade cron.
 *
 * Quota cost
 *   channels.list with `id=` accepts up to 50 IDs per call, costs 1 unit.
 *   With 38 active channels we make 1 call/day → 1 unit/day out of 10,000.
 *
 * Source authority
 *   Pinned per locked decision (2026-05-14): YouTube Data API v3 is the
 *   primary source. Social Blade ingest (api/update-youtube-stats.js) is
 *   retained in git history as a fallback only — its cron path is unwired.
 *
 * Subscriber-count caveat
 *   YouTube rounds subscriberCount for channels > 1k subs (e.g. 81,300,000).
 *   daily_subscribers therefore moves in 1k / 10k / 100k bands, not unit
 *   precision. viewCount and videoCount are exact integers.
 *
 * Vercel cron schedule (set in vercel.json): "30 0 * * *"  (00:30 UTC = 06:00 IST).
 */

import { createClient } from '@supabase/supabase-js';
import { fetchWithRetry } from '../lib/fetch-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const YT_BATCH_SIZE = 50;                       // channels.list max ids per call
const MAX_DAILY_VIEWS_PER_CHANNEL = 50_000_000; // sanity bound; matches old SB cron
const MAX_DAILY_VIDEOS_PER_CHANNEL = 10_000;    // >10k uploads/day = scraper error

async function fetchYouTubeChannels(channelIds) {
  const out = [];
  for (let i = 0; i < channelIds.length; i += YT_BATCH_SIZE) {
    const chunk = channelIds.slice(i, i + YT_BATCH_SIZE);
    const url =
      `https://www.googleapis.com/youtube/v3/channels` +
      `?part=statistics,snippet` +
      `&id=${chunk.join(',')}` +
      `&maxResults=${YT_BATCH_SIZE}` +
      `&key=${YOUTUBE_API_KEY}`;

    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`YouTube API ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = await resp.json();
    out.push(...(json.items ?? []));
  }
  return out;
}

function bounded(delta, max) {
  if (delta == null || Number.isNaN(delta)) return null;
  if (delta > max) return null;
  return delta;
}

function processChannel(ytItem, prior, todayDate) {
  const s = ytItem.statistics ?? {};

  // YouTube returns these as strings; coerce + treat missing as null.
  const total_views = s.viewCount != null ? Number(s.viewCount) : null;
  const subscribers = s.hiddenSubscriberCount
    ? null
    : s.subscriberCount != null ? Number(s.subscriberCount) : null;
  const video_count = s.videoCount != null ? Number(s.videoCount) : null;

  let daily_views = null;
  let daily_subscribers = null;
  let daily_videos = null;

  if (prior?.date) {
    const gap = Math.round(
      (new Date(todayDate) - new Date(prior.date)) / 86_400_000
    );
    if (gap === 1) {
      if (total_views != null && prior.total_views != null) {
        const dv = total_views - prior.total_views;
        // Negative views means YT audit correction → store null (matches old policy)
        if (dv >= 0) daily_views = bounded(dv, MAX_DAILY_VIEWS_PER_CHANNEL);
      }
      if (subscribers != null && prior.subscribers != null) {
        // Negatives allowed (lost subs), bound is enforced by chk_daily_subs_valid CHECK
        daily_subscribers = subscribers - prior.subscribers;
      }
      if (video_count != null && prior.video_count != null) {
        const dvd = video_count - prior.video_count;
        if (Math.abs(dvd) <= MAX_DAILY_VIDEOS_PER_CHANNEL) daily_videos = dvd;
      }
    }
  }

  return {
    channel_id: ytItem.id,
    date: todayDate,
    total_views,
    subscribers,
    video_count,
    daily_views,
    daily_subscribers,
    daily_videos,
    updated_at: new Date().toISOString(),
  };
}

async function logError(supabase, error_type, error_message, error_details) {
  try {
    await supabase
      .from('error_logs')
      .insert([{ error_type, error_message, error_details }]);
  } catch (e) {
    console.error('Failed to write error_logs:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const provided = req.headers.authorization?.replace('Bearer ', '');
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({ success: false, error: 'YOUTUBE_API_KEY not configured' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  console.log('🚀 Starting YT Data API v3 channel ingest...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1) Active channels
  const { data: channels, error: chErr } = await supabase
    .from('youtube_channels')
    .select('channel_id, channel_name')
    .eq('is_active', true);

  if (chErr) {
    await logError(supabase, 'youtube_channels_query_failed', chErr.message, {
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ success: false, error: `Channels query: ${chErr.message}` });
  }
  if (!channels?.length) {
    return res.status(200).json({ success: true, message: 'No active channels' });
  }

  const todayDate = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .split('T')[0];

  // 2) Prior rows for delta math (bulk; one query for the whole batch)
  const { data: priorRows, error: priorErr } = await supabase
    .from('youtube_channel_stats')
    .select('channel_id, date, total_views, subscribers, video_count')
    .gte('date', sevenDaysAgo)
    .lt('date', todayDate)
    .order('date', { ascending: false });

  if (priorErr) {
    console.warn(`Prior-rows query failed: ${priorErr.message}. Proceeding without deltas.`);
  }

  const priorByChannel = new Map();
  for (const r of priorRows ?? []) {
    if (!priorByChannel.has(r.channel_id)) priorByChannel.set(r.channel_id, r);
  }

  // 3) One API call (or two if >50 channels) for all stats
  let ytItems;
  try {
    ytItems = await fetchYouTubeChannels(channels.map((c) => c.channel_id));
    console.log(`Fetched ${ytItems.length}/${channels.length} channels from YT API`);
  } catch (err) {
    await logError(supabase, 'youtube_api_fetch_failed', err.message, {
      stack: err.stack,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({ success: false, error: err.message });
  }

  const ytById = new Map(ytItems.map((it) => [it.id, it]));

  // 4) Build upsert records; track channels the API didn't return
  const upsertRecords = [];
  const missing = [];
  for (const ch of channels) {
    const it = ytById.get(ch.channel_id);
    if (!it) {
      missing.push({ channel_id: ch.channel_id, channel_name: ch.channel_name });
      continue;
    }
    upsertRecords.push(
      processChannel(it, priorByChannel.get(ch.channel_id), todayDate)
    );
  }

  // 5) Chunked upsert so one bad row doesn't kill the batch
  const CHUNK = 10;
  let upsertedCount = 0;
  const failed = [];
  for (let i = 0; i < upsertRecords.length; i += CHUNK) {
    const chunk = upsertRecords.slice(i, i + CHUNK);
    const { error: upErr } = await supabase
      .from('youtube_channel_stats')
      .upsert(chunk, { onConflict: 'channel_id,date' });
    if (upErr) {
      failed.push(...chunk.map((r) => ({ channel_id: r.channel_id, error: upErr.message })));
    } else {
      upsertedCount += chunk.length;
    }
  }

  if (missing.length || failed.length) {
    await logError(
      supabase,
      'youtube_ingest_partial',
      `${missing.length} channel(s) missing from YT API response, ${failed.length} upsert failure(s)`,
      { missing, failed, timestamp: new Date().toISOString() }
    );
  }

  console.log(`✅ Done: ${upsertedCount} upserted, ${missing.length} missing, ${failed.length} failed`);

  return res.status(200).json({
    success: true,
    date: todayDate,
    channels_total: channels.length,
    channels_upserted: upsertedCount,
    channels_missing_from_yt_api: missing.length,
    channels_failed_upsert: failed.length,
    quota_units_used: Math.ceil(channels.length / YT_BATCH_SIZE),
  });
}
