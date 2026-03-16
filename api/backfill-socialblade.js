/**
 * Historical backfill: fetches Social Blade daily history for one or all channels
 * and upserts into youtube_channel_stats.
 *
 * Social Blade returns ~30 days of history per call in the standard `daily` array.
 * Each entry has: { date (ISO), subs, views } — cumulative totals.
 * Daily deltas are computed from consecutive entries.
 *
 * Usage:
 *   GET /api/backfill-socialblade?channel_id=UCJrDMFOdv1I2k8n9oK_V21w
 *   GET /api/backfill-socialblade?channel_id=all&since=2026-01-01
 *   Authorization: Bearer {CRON_SECRET}
 *
 * Query params:
 *   channel_id  UCxxxxxx or "all"
 *   since       ISO date (default: 2026-01-01) — records before this date are dropped
 *
 * Note: Social Blade returns ~30 days on the standard plan. Records older than that
 *       are only available via legacy migration or a higher-tier plan.
 *       Channels are processed sequentially to avoid rate limiting.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const SB_CLIENT_ID = process.env.SOCIAL_BLADE_CLIENT_ID;
const SB_TOKEN    = process.env.SOCIAL_BLADE_TOKEN;

async function fetchSocialBladeStats(handle) {
  const url = `https://matrix.sbapis.com/b/youtube/statistics?clientid=${SB_CLIENT_ID}&token=${SB_TOKEN}&query=${encodeURIComponent(handle)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Social Blade API returned ${resp.status} for "${handle}"`);
  const json = await resp.json();
  if (!json.status?.success) {
    throw new Error(`Social Blade error for "${handle}": ${JSON.stringify(json.status)}`);
  }
  return json.data;
}

function buildRecords(channelId, data) {
  const daily = (data.daily || []).slice().reverse(); // oldest first for correct delta computation
  const totalUploads = data.statistics?.total?.uploads ?? null;
  const records = [];

  for (let i = 0; i < daily.length; i++) {
    const entry = daily[i];
    const prev  = daily[i - 1] ?? null;

    const daily_views       = (prev && entry.views != null && prev.views != null)
      ? entry.views - prev.views
      : null;
    const daily_subscribers = (prev && entry.subs != null && prev.subs != null)
      ? entry.subs - prev.subs
      : null;

    records.push({
      channel_id:        channelId,
      date:              entry.date.split('T')[0],
      total_views:       entry.views ?? null,
      subscribers:       entry.subs  ?? null,
      video_count:       i === daily.length - 1 ? totalUploads : null, // only set for latest
      daily_views,
      daily_subscribers,
      daily_videos:      null,
      updated_at:        new Date().toISOString(),
    });
  }

  return records;
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

  const channelParam = req.query.channel_id;
  if (!channelParam) {
    return res.status(400).json({ success: false, error: 'channel_id query param required (UCxxxxxx or "all")' });
  }

  const since = req.query.since || '2026-01-01';

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch target channels
  let query = supabase.from('youtube_channels').select('channel_id, channel_name, handle').eq('is_active', true);
  if (channelParam !== 'all') {
    query = query.eq('channel_id', channelParam);
  }

  const { data: channels, error: chErr } = await query;
  if (chErr) return res.status(500).json({ success: false, error: chErr.message });
  if (!channels?.length) return res.status(404).json({ success: false, error: 'No active channels found for query' });

  console.log(`🔄 Backfilling ${channels.length} channel(s)...`);

  const summary = [];

  for (const channel of channels) {
    if (!channel.handle) {
      console.log(`  ⚠️  Skipping ${channel.channel_name} (no handle)`);
      summary.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, status: 'skipped', reason: 'no handle' });
      continue;
    }

    try {
      const data = await fetchSocialBladeStats(channel.handle);
      const allRecords = buildRecords(channel.channel_id, data);
      const records = allRecords.filter(r => r.date >= since);

      if (records.length === 0) {
        summary.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, status: 'skipped', reason: 'no daily data' });
        continue;
      }

      // Batch upsert in chunks of 500
      const BATCH = 500;
      let upserted = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const { error } = await supabase
          .from('youtube_channel_stats')
          .upsert(records.slice(i, i + BATCH), { onConflict: 'channel_id,date' });
        if (error) throw error;
        upserted += Math.min(BATCH, records.length - i);
      }

      console.log(`  ✅ ${channel.channel_name}: ${upserted} records`);
      summary.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, status: 'ok', records: upserted });

    } catch (err) {
      console.error(`  ❌ ${channel.channel_name}: ${err.message}`);
      summary.push({ channel_id: channel.channel_id, channel_name: channel.channel_name, status: 'error', error: err.message });
    }
  }

  const totalRecords = summary.filter(s => s.status === 'ok').reduce((n, s) => n + (s.records || 0), 0);
  const failed = summary.filter(s => s.status === 'error');

  return res.status(200).json({
    success: failed.length === 0,
    since,
    channels_processed: channels.length,
    total_records_upserted: totalRecords,
    summary,
  });
}
