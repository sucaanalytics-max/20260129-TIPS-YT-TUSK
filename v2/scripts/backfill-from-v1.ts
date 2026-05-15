/**
 * One-shot migration: v1 Supabase → v2 Supabase
 *
 *   v1 youtube_channel_stats  → v2 fct_channel_daily
 *   v1 stock_prices           → v2 fct_price_daily
 *   v1 youtube_channels       → v2 dim_channel (reconcile with seed)
 *
 * Run with: `npx tsx scripts/backfill-from-v1.ts [--dry-run] [--since YYYY-MM-DD]`
 *
 * Env:
 *   V1_SUPABASE_URL                 (e.g. https://bfafqccvzboyfjewzvhk.supabase.co)
 *   V1_SUPABASE_ANON_KEY            (v1 RLS is USING(true), anon suffices)
 *   SUPABASE_URL                    v2 target
 *   SUPABASE_SERVICE_ROLE_KEY       v2 target service-role
 *
 * Idempotency: every insert is an upsert keyed on natural PK. Safe to re-run.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PAGE = 1000;

interface V1ChannelStat {
  channel_id: string;
  date: string;
  total_views: number | null;
  subscribers: number | null;
  video_count: number | null;
  daily_views: number | null;
  daily_subscribers: number | null;
  daily_videos: number | null;
}

interface V1Channel {
  channel_id: string;
  channel_name: string;
  company: string;
  handle: string | null;
  is_active: boolean;
}

interface V1StockPrice {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  source: string | null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const v1 = makeClient(requiredEnv('V1_SUPABASE_URL'), requiredEnv('V1_SUPABASE_ANON_KEY'));
  const v2 = makeClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

  console.log(`[backfill] dry-run=${args.dryRun} since=${args.since ?? 'all'}`);

  let runId: number | null = null;
  if (!args.dryRun) {
    const { data, error } = await v2
      .from('ops_ingest_run')
      .insert({ source: 'backfill_v1', status: 'running' })
      .select('run_id')
      .single();
    if (error || !data) throw new Error(`open backfill run: ${error?.message}`);
    runId = data.run_id as number;
    console.log(`[backfill] opened run_id=${runId}`);
  }

  try {
    const channelStats = await migrateChannels(v1, v2, runId, args);
    const stockStats = await migrateStockPrices(v1, v2, runId, args);

    if (runId !== null && !args.dryRun) {
      await v2
        .from('ops_ingest_run')
        .update({
          status: 'ok',
          ended_at: new Date().toISOString(),
          rows_in: channelStats.read + stockStats.read,
          rows_out: channelStats.written + stockStats.written,
          detail: { channelStats, stockStats },
        })
        .eq('run_id', runId);
    }

    console.log('[backfill] done', { channelStats, stockStats });
  } catch (err) {
    console.error('[backfill] failed:', err);
    if (runId !== null && !args.dryRun) {
      await v2.from('ops_error_log').insert({
        error_type: 'backfill_failed',
        error_message: (err as Error).message,
        detail: { stack: (err as Error).stack },
        ingest_run_id: runId,
      });
      await v2
        .from('ops_ingest_run')
        .update({ status: 'failed', ended_at: new Date().toISOString(), detail: { error: (err as Error).message } })
        .eq('run_id', runId);
    }
    process.exit(1);
  }
}

async function migrateChannels(
  v1: SupabaseClient,
  v2: SupabaseClient,
  runId: number | null,
  args: Args,
): Promise<{ read: number; written: number; legacyRows: number }> {
  // 1) dim_channel reconciliation
  const { data: channels, error: chErr } = await v1
    .from('youtube_channels')
    .select('channel_id, channel_name, company, handle, is_active');
  if (chErr) throw new Error(`v1 youtube_channels: ${chErr.message}`);
  const allChannels = (channels ?? []) as V1Channel[];

  // Split: real channels (UCxxxx) vs legacy aggregates (*_LEGACY)
  const real = allChannels.filter((c) => !c.channel_id.endsWith('_LEGACY'));
  const legacy = allChannels.filter((c) => c.channel_id.endsWith('_LEGACY'));

  // Real channels are already seeded in v2 by /api/cron/seed/route.ts. We
  // upsert anyway so any v1-only rows land (best-effort). Legacy aggregates
  // become non-active rows so their historical daily_views still flow into
  // v_company_daily via the WHERE c.is_active=true filter override below
  // — actually they DO get filtered out, matching v1 migration-002 semantics.
  if (!args.dryRun) {
    const realRows = real.map((c) => ({
      channel_id: c.channel_id,
      channel_name: c.channel_name,
      company: c.company,
      handle: c.handle,
      is_active: c.is_active,
    }));
    if (realRows.length) {
      const { error } = await v2.from('dim_channel').upsert(realRows, { onConflict: 'channel_id' });
      if (error) throw new Error(`dim_channel upsert: ${error.message}`);
    }
    const legacyRows = legacy.map((c) => ({
      channel_id: c.channel_id,
      channel_name: c.channel_name,
      company: c.company,
      handle: null,
      is_active: false,
    }));
    if (legacyRows.length) {
      const { error } = await v2.from('dim_channel').upsert(legacyRows, { onConflict: 'channel_id' });
      if (error) throw new Error(`dim_channel legacy upsert: ${error.message}`);
    }
  }

  // 2) youtube_channel_stats → fct_channel_daily, paged
  let from = 0;
  let read = 0;
  let written = 0;
  for (;;) {
    let q = v1
      .from('youtube_channel_stats')
      .select('channel_id, date, total_views, subscribers, video_count, daily_views, daily_subscribers, daily_videos')
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (args.since) q = q.gte('date', args.since);
    const { data, error } = await q;
    if (error) throw new Error(`v1 youtube_channel_stats page ${from}: ${error.message}`);
    const rows = (data ?? []) as V1ChannelStat[];
    if (rows.length === 0) break;
    read += rows.length;

    if (!args.dryRun) {
      const toWrite = rows.map((r) => ({
        channel_id: r.channel_id,
        date: r.date,
        total_views: r.total_views,
        subscribers: r.subscribers,
        video_count: r.video_count,
        daily_views: r.daily_views,
        daily_subscribers: r.daily_subscribers,
        daily_videos: r.daily_videos,
        ingest_run_id: runId,
      }));
      // CHECK constraints in v2 may reject rows v1 retained (different bounds).
      // Insert in chunks of 100 so a single bad row doesn't kill the whole page.
      for (let i = 0; i < toWrite.length; i += 100) {
        const chunk = toWrite.slice(i, i + 100);
        const { error: upErr } = await v2
          .from('fct_channel_daily')
          .upsert(chunk, { onConflict: 'channel_id,date' });
        if (upErr) {
          // Log + continue — invalid rows shouldn't block migration.
          await v2.from('ops_error_log').insert({
            error_type: 'backfill_channel_chunk',
            error_message: upErr.message,
            detail: { from: i, to: i + chunk.length, sample: chunk.slice(0, 3) },
            ingest_run_id: runId,
          });
          continue;
        }
        written += chunk.length;
      }
    }

    console.log(`[backfill] channel-stats: read=${read} written=${written}`);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return { read, written, legacyRows: legacy.length };
}

async function migrateStockPrices(
  v1: SupabaseClient,
  v2: SupabaseClient,
  runId: number | null,
  args: Args,
): Promise<{ read: number; written: number }> {
  let from = 0;
  let read = 0;
  let written = 0;
  for (;;) {
    let q = v1
      .from('stock_prices')
      .select('symbol, date, open, high, low, close, volume, source')
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (args.since) q = q.gte('date', args.since);
    const { data, error } = await q;
    if (error) throw new Error(`v1 stock_prices page ${from}: ${error.message}`);
    const rows = (data ?? []) as V1StockPrice[];
    if (rows.length === 0) break;
    read += rows.length;

    if (!args.dryRun) {
      const toWrite = rows.map((r) => ({
        symbol: r.symbol === 'TIPSINDLTD' ? 'TIPSMUSIC' : r.symbol,
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume ?? 0,
        source: r.source ?? 'historical',
        ingest_run_id: runId,
      }));
      const { error: upErr } = await v2
        .from('fct_price_daily')
        .upsert(toWrite, { onConflict: 'symbol,date' });
      if (upErr) {
        await v2.from('ops_error_log').insert({
          error_type: 'backfill_stock_page',
          error_message: upErr.message,
          detail: { from, to: from + rows.length },
          ingest_run_id: runId,
        });
      } else {
        written += rows.length;
      }
    }
    console.log(`[backfill] stock-prices: read=${read} written=${written}`);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // Trigger adjusted-close recompute for every symbol that landed
  if (!args.dryRun) {
    const { data: symbols } = await v2.from('fct_price_daily').select('symbol').limit(50);
    const uniqueSymbols = Array.from(new Set((symbols ?? []).map((r) => r.symbol as string)));
    for (const symbol of uniqueSymbols) {
      const { error } = await v2.rpc('recompute_adjusted_close', { target_symbol: symbol });
      if (error) {
        console.warn(`[backfill] recompute_adjusted_close(${symbol}) failed: ${error.message}`);
      }
    }
  }

  return { read, written };
}

// ---- helpers ----------------------------------------------------------------

interface Args { dryRun: boolean; since?: string }

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--since' && argv[i + 1]) {
      args.since = argv[++i];
    }
  }
  return args;
}

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function makeClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'public' },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
