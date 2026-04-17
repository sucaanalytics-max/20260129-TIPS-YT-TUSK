/**
 * Health check endpoint — reports pipeline status at a glance.
 *
 * Returns:
 *   - Last YouTube data date per company
 *   - Channels with data in last 24h vs total active
 *   - Last stock price date per symbol
 *   - Recent errors from error_logs (if table exists)
 *
 * Usage:
 *   GET /api/health
 *   Authorization: Bearer {CRON_SECRET}
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

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
  const issues = [];
  const checks = {};

  // 1. YouTube: most recent data date
  const { data: ytLatest } = await supabase
    .from('youtube_channel_stats')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  checks.youtube_latest_date = ytLatest?.date ?? null;

  // 2. Active channels vs channels with recent data
  const { count: activeChannels } = await supabase
    .from('youtube_channels')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const { data: recentRows } = await supabase
    .from('youtube_channel_stats')
    .select('channel_id')
    .gte('date', yesterday);

  const recentChannelIds = new Set((recentRows ?? []).map(r => r.channel_id));
  checks.youtube_active_channels = activeChannels;
  checks.youtube_channels_scraped_last_24h = recentChannelIds.size;

  if (recentChannelIds.size < (activeChannels ?? 0) * 0.8) {
    issues.push(`Only ${recentChannelIds.size}/${activeChannels} channels have data in last 24h`);
  }

  // 3. Stock: most recent date per symbol
  const { data: stockRows } = await supabase
    .from('stock_prices')
    .select('symbol, date, close')
    .order('date', { ascending: false })
    .limit(4);

  // Deduplicate to latest per symbol
  const stockLatest = {};
  for (const r of stockRows ?? []) {
    if (!stockLatest[r.symbol]) stockLatest[r.symbol] = r;
  }
  checks.stock_latest = Object.values(stockLatest);

  // 4. Recent errors (last 7 days) — table may not exist
  let recentErrors = [];
  const { data: errors, error: errLogErr } = await supabase
    .from('error_logs')
    .select('error_type, error_message, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (!errLogErr) {
    recentErrors = errors ?? [];
  }
  checks.recent_errors_7d = recentErrors.length;

  // 5. Days with data in last 7 days
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: weekRows } = await supabase
    .from('youtube_channel_stats')
    .select('date')
    .gte('date', weekAgo);

  const uniqueDates = [...new Set((weekRows ?? []).map(r => r.date))];
  checks.youtube_days_with_data_last_7 = uniqueDates.length;

  if (uniqueDates.length < 6) {
    issues.push(`Only ${uniqueDates.length}/7 days have YouTube data in last week`);
  }

  const healthy = issues.length === 0;

  return res.status(healthy ? 200 : 503).json({
    healthy,
    checked_at: new Date().toISOString(),
    checks,
    issues: issues.length > 0 ? issues : undefined,
    recent_errors: recentErrors.length > 0 ? recentErrors : undefined,
  });
}
