/**
 * Daily cron: fetches latest channel stats from Social Blade API for all
 * active channels and upserts into youtube_channel_stats.
 *
 * Social Blade API response structure (confirmed):
 *   data.daily[0] = most recent day  { date (ISO), subs, views }
 *   data.daily[1] = previous day
 *   data.statistics.total.uploads = current cumulative video count
 *
 * Daily views  = daily[0].views - daily[1].views  (delta between last 2 snapshots)
 * Daily subs   = daily[0].subs  - daily[1].subs
 *
 * Data validation:
 *   - Consecutive-day check: dates must be exactly 1 day apart
 *   - Negative delta rejection: YouTube audit corrections stored as null
 *   - Spike rejection: >50M views per channel per day is impossible
 *
 * Vercel cron schedule: "30 0 * * *"  (00:30 UTC = 06:00 IST, daily)
 */

import { createClient } from '@supabase/supabase-js';
import { fetchWithRetry } from './lib/fetch-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SB_CLIENT_ID = process.env.SOCIAL_BLADE_CLIENT_ID;
const SB_TOKEN    = process.env.SOCIAL_BLADE_TOKEN;

const MAX_DAILY_VIEWS_PER_CHANNEL = 50000000; // 50M — no single channel exceeds this in a day
const PARALLEL_BATCH_SIZE = 5; // Fetch 5 channels at a time to stay within 10s timeout
const UPSERT_CHUNK_SIZE = 10;  // Upsert in small chunks so one bad record doesn't kill the batch

async function fetchSocialBladeStats(handle) {
  const query = handle || '';
  const url = `https://matrix.sbapis.com/b/youtube/statistics?clientid=${SB_CLIENT_ID}&token=${SB_TOKEN}&query=${encodeURIComponent(query)}`;

  const resp = await fetchWithRetry(url);
  if (!resp.ok) throw new Error(`Social Blade API returned ${resp.status} for "${handle}"`);

  const json = await resp.json();
  if (!json.status?.success) {
    throw new Error(`Social Blade error for "${handle}": ${JSON.stringify(json.status)}`);
  }

  return json.data;
}

function processChannelData(channel, data) {
  const daily = data.daily || [];
  if (daily.length < 2) {
    throw new Error(`Insufficient daily history (${daily.length} entries)`);
  }

  const today = daily[0];
  const yesterday = daily[1];

  // Validate: dates must be exactly 1 day apart
  const todayDate = new Date(today.date);
  const yesterdayDate = new Date(yesterday.date);
  const dayGap = Math.round((todayDate - yesterdayDate) / 86400000);

  let daily_views = null;
  let daily_subscribers = null;

  if (dayGap === 1) {
    daily_views = (today.views != null && yesterday.views != null)
      ? today.views - yesterday.views : null;
    daily_subscribers = (today.subs != null && yesterday.subs != null)
      ? today.subs - yesterday.subs : null;
  } else {
    console.warn(`  ⚠️ ${channel.channel_name}: ${dayGap}-day gap (${yesterday.date.split('T')[0]} → ${today.date.split('T')[0]}), storing null delta`);
  }

  // Reject negative deltas (YouTube audit corrections)
  if (daily_views !== null && daily_views < 0) {
    console.warn(`  ⚠️ ${channel.channel_name}: negative daily_views (${daily_views}), setting null`);
    daily_views = null;
  }

  // Reject impossible spikes
  if (daily_views !== null && daily_views > MAX_DAILY_VIEWS_PER_CHANNEL) {
    console.warn(`  ⚠️ ${channel.channel_name}: spike ${daily_views} > ${MAX_DAILY_VIEWS_PER_CHANNEL}, setting null`);
    daily_views = null;
  }

  return {
    channel_id:        channel.channel_id,
    date:              today.date.split('T')[0],
    total_views:       data.statistics?.total?.views     ?? null,
    subscribers:       data.statistics?.total?.subscribers ?? null,
    video_count:       data.statistics?.total?.uploads   ?? null,
    daily_views,
    daily_subscribers,
    daily_videos:      null,
    updated_at:        new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader?.replace('Bearer ', '') !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!SB_CLIENT_ID || !SB_TOKEN) {
    return res.status(500).json({ success: false, error: 'SOCIAL_BLADE_CLIENT_ID / SOCIAL_BLADE_TOKEN not configured' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  console.log('🚀 Starting YouTube stats update...');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch all active channels
  const { data: channels, error: chErr } = await supabase
    .from('youtube_channels')
    .select('channel_id, channel_name, handle')
    .eq('is_active', true);

  if (chErr) {
    return res.status(500).json({ success: false, error: `Failed to fetch channels: ${chErr.message}` });
  }

  console.log(`Found ${channels.length} active channels`);

  const upsertRecords = [];
  const failed = [];

  // Process channels in parallel batches of 5 to stay within Vercel timeout
  for (let i = 0; i < channels.length; i += PARALLEL_BATCH_SIZE) {
    const batch = channels.slice(i, i + PARALLEL_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (channel) => {
        const data = await fetchSocialBladeStats(channel.handle);
        return processChannelData(channel, data);
      })
    );

    results.forEach((result, idx) => {
      const channel = batch[idx];
      if (result.status === 'fulfilled') {
        upsertRecords.push(result.value);
        const dv = result.value.daily_views;
        console.log(`  ✅ ${channel.channel_name}: ${dv?.toLocaleString() ?? 'N/A'} views`);
      } else {
        console.error(`  ❌ ${channel.channel_name}: ${result.reason.message}`);
        failed.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, error: result.reason.message });
      }
    });
  }

  // Chunked upsert — one bad record doesn't kill the entire batch
  let upsertedCount = 0;
  for (let i = 0; i < upsertRecords.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = upsertRecords.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error: upsertErr } = await supabase
      .from('youtube_channel_stats')
      .upsert(chunk, { onConflict: 'channel_id,date' });

    if (upsertErr) {
      console.error(`Upsert chunk ${i}-${i + chunk.length} failed:`, upsertErr.message);
      failed.push(...chunk.map(r => ({ channel_id: r.channel_id, error: upsertErr.message })));
    } else {
      upsertedCount += chunk.length;
    }
  }

  if (failed.length > 0) {
    try {
      await supabase.from('error_logs').insert([{
        error_type: 'youtube_channel_fetch_failed',
        error_message: `${failed.length} channel(s) failed to update`,
        error_details: { failed, timestamp: new Date().toISOString() },
      }]);
    } catch (logErr) {
      console.error('Failed to log errors:', logErr.message);
    }
  }

  console.log(`✅ Done: ${upsertedCount} channels updated, ${failed.length} failed`);

  return res.status(200).json({
    success: true,
    channels_updated: upsertedCount,
    channels_failed: failed.length,
    date: upsertRecords[0]?.date ?? null,
    failed: failed.length > 0 ? failed : undefined,
  });
}
