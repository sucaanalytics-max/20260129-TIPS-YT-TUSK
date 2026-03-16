/**
 * One-time migration: copies existing Social Blade aggregate data from
 * tips_youtube_data and saregama_youtube_data into youtube_channel_stats
 * under virtual legacy channel IDs (TIPSMUSIC_LEGACY, SAREGAMA_LEGACY).
 *
 * Run AFTER the SQL migration (001_youtube_channels.sql) but BEFORE
 * switching the dashboard to the new views.
 *
 * Safe to re-run: uses upsert with onConflict: 'channel_id,date'
 *
 * Usage:
 *   GET /api/migrate-legacy-data
 *   Authorization: Bearer {CRON_SECRET}
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const PAGE_SIZE = 1000;

async function fetchAllRows(supabase, table) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
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

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const migrations = [
    { sourceTable: 'tips_youtube_data',     legacyChannelId: 'TIPSMUSIC_LEGACY' },
    { sourceTable: 'saregama_youtube_data', legacyChannelId: 'SAREGAMA_LEGACY'  },
  ];

  const results = {};

  for (const { sourceTable, legacyChannelId } of migrations) {
    try {
      console.log(`Migrating ${sourceTable} → ${legacyChannelId}...`);

      const sourceRows = await fetchAllRows(supabase, sourceTable);
      console.log(`  Found ${sourceRows.length} rows`);

      if (sourceRows.length === 0) {
        results[legacyChannelId] = { migrated: 0, note: 'source table empty or missing' };
        continue;
      }

      // Map source columns → youtube_channel_stats columns
      const records = sourceRows.map(row => ({
        channel_id:        legacyChannelId,
        date:              row.date,
        total_views:       row.total_views   ?? null,
        subscribers:       row.subscribers   ?? null,
        video_count:       row.video_count   ?? null,
        daily_views:       row.daily_views   ?? null,
        daily_subscribers: row.daily_subscribers ?? null,
        daily_videos:      row.daily_videos  ?? null,
        updated_at:        new Date().toISOString(),
      }));

      // Batch upsert in chunks of 500 to stay within Supabase request limits
      const BATCH = 500;
      let upserted = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        const { error } = await supabase
          .from('youtube_channel_stats')
          .upsert(chunk, { onConflict: 'channel_id,date' });
        if (error) throw error;
        upserted += chunk.length;
      }

      results[legacyChannelId] = { migrated: upserted };
      console.log(`  ✅ Migrated ${upserted} rows`);

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results[legacyChannelId] = { error: err.message };
    }
  }

  const allOk = Object.values(results).every(r => !r.error);

  return res.status(allOk ? 200 : 500).json({
    success: allOk,
    results,
    note: 'Original tables (tips_youtube_data, saregama_youtube_data) were NOT modified.',
  });
}
