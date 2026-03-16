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
 * Vercel cron schedule: "0 6 * * *"  (06:00 UTC = 11:30 IST, daily)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SB_CLIENT_ID = process.env.SOCIAL_BLADE_CLIENT_ID;
const SB_TOKEN    = process.env.SOCIAL_BLADE_TOKEN;

async function fetchSocialBladeStats(handle) {
  const query = handle || '';
  const url = `https://matrix.sbapis.com/b/youtube/statistics?clientid=${SB_CLIENT_ID}&token=${SB_TOKEN}&query=${encodeURIComponent(query)}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Social Blade API returned ${resp.status} for "${handle}"`);

  const json = await resp.json();
  if (!json.status?.success) {
    throw new Error(`Social Blade error for "${handle}": ${JSON.stringify(json.status)}`);
  }

  return json.data;
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

  for (const channel of channels) {
    try {
      const data = await fetchSocialBladeStats(channel.handle);

      const daily = data.daily || [];
      if (daily.length < 2) {
        throw new Error(`Insufficient daily history (${daily.length} entries)`);
      }

      const today = daily[0];
      const yesterday = daily[1];

      // Compute deltas from consecutive snapshots
      const daily_views       = (today.views != null && yesterday.views != null)
        ? today.views - yesterday.views
        : null;
      const daily_subscribers = (today.subs != null && yesterday.subs != null)
        ? today.subs - yesterday.subs
        : null;

      const record = {
        channel_id:        channel.channel_id,
        date:              today.date.split('T')[0],         // "2026-03-16T00:00:00.000Z" → "2026-03-16"
        total_views:       data.statistics?.total?.views     ?? null,
        subscribers:       data.statistics?.total?.subscribers ?? null,
        video_count:       data.statistics?.total?.uploads   ?? null,
        daily_views,
        daily_subscribers,
        daily_videos:      null,  // Social Blade daily array doesn't include per-day video counts
        updated_at:        new Date().toISOString(),
      };

      upsertRecords.push(record);
      console.log(`  ✅ ${channel.channel_name}: ${daily_views?.toLocaleString() ?? 'N/A'} views`);

    } catch (err) {
      console.error(`  ❌ ${channel.channel_name}: ${err.message}`);
      failed.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, error: err.message });
    }
  }

  // Batch upsert all collected records
  let upsertedCount = 0;
  if (upsertRecords.length > 0) {
    const { error: upsertErr } = await supabase
      .from('youtube_channel_stats')
      .upsert(upsertRecords, { onConflict: 'channel_id,date' });

    if (upsertErr) {
      console.error('Batch upsert failed:', upsertErr);
      // Log to error_logs
      await supabase.from('error_logs').insert([{
        error_type: 'youtube_stats_update_failed',
        error_message: upsertErr.message,
        error_details: { records_attempted: upsertRecords.length, timestamp: new Date().toISOString() },
      }]);
      return res.status(500).json({ success: false, error: upsertErr.message, failed });
    }
    upsertedCount = upsertRecords.length;
  }

  if (failed.length > 0) {
    await supabase.from('error_logs').insert([{
      error_type: 'youtube_channel_fetch_failed',
      error_message: `${failed.length} channel(s) failed to update`,
      error_details: { failed, timestamp: new Date().toISOString() },
    }]);
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
