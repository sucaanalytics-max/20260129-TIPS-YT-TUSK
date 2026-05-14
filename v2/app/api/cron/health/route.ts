import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Daily health check. Reads ops_ingest_run + freshness across fact tables and,
 * if any check is red, optionally posts to a Slack webhook.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const issues: string[] = [];

  // 1) Freshness per fact table
  const checks: Record<string, { latest_date: string | null; age_days: number | null }> = {};
  for (const table of ['fct_channel_daily', 'fct_video_daily', 'fct_price_daily'] as const) {
    const { data } = await supabase
      .from(table)
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
    const latest = data?.[0]?.date ?? null;
    const age = latest ? ageDays(latest) : null;
    checks[table] = { latest_date: latest, age_days: age };
    if (age == null || age > 2) issues.push(`${table} is ${age ?? '∞'}d stale`);
  }

  // 2) Recent failed runs
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: failed } = await supabase
    .from('ops_ingest_run')
    .select('source, started_at, status')
    .eq('status', 'failed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(10);
  const failedRuns = failed ?? [];
  if (failedRuns.length) issues.push(`${failedRuns.length} failed run(s) in last 3d`);

  // 3) Recent error_log entries
  const { data: errors } = await supabase
    .from('ops_error_log')
    .select('error_type, error_message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  const healthy = issues.length === 0;

  // 4) Optional Slack alert on red
  if (!healthy && env.SLACK_ALERT_WEBHOOK_URL) {
    try {
      await fetch(env.SLACK_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:warning: Tusk YT v2 health check failed\n${issues.map((i) => `• ${i}`).join('\n')}`,
        }),
      });
    } catch {
      // best effort
    }
  }

  return NextResponse.json(
    {
      ok: healthy,
      checked_at: new Date().toISOString(),
      checks,
      issues: issues.length ? issues : undefined,
      failed_runs: failedRuns,
      recent_errors: errors ?? [],
    },
    { status: healthy ? 200 : 503 },
  );
}

function ageDays(isoDate: string): number {
  const then = new Date(isoDate + 'T00:00:00Z').getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
