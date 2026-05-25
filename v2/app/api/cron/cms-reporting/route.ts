import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { env, cmsContentOwnerIds } from '@/lib/env';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';
import {
  REPORT_TYPES,
  createReportingJob,
  downloadReport,
  getAccessToken,
  listReportingJobs,
  listReports,
  parseReportingCsv,
  parseServiceAccount,
  ytDateToIso,
  type ReportEntry,
  type ServiceAccount,
} from '@/lib/youtube-cms';

export const maxDuration = 300;

/**
 * YouTube CMS / Content Owner Reporting API ingest.
 *
 * DORMANT until env.YT_CMS_SERVICE_ACCOUNT_JSON + env.YT_CMS_CONTENT_OWNER_IDS
 * are provisioned. Until then it no-ops and writes a 'skipped' run row.
 *
 * Activation path:
 *   1. A label provisions a CMS-side service-account invitation with
 *      youtubepartner-content-owner-readonly scope.
 *   2. We add the service-account email as a Content Manager (Read-Only
 *      Analyst) in their CMS via studio.youtube.com → Settings →
 *      Permissions → Manage CMS Users.
 *   3. Paste the service-account JSON (single line) into Vercel env
 *      YT_CMS_SERVICE_ACCOUNT_JSON.
 *   4. Add the Content Owner ID mapping in YT_CMS_CONTENT_OWNER_IDS as
 *      "TIPSMUSIC:<id>" or "SAREGAMA:<id>" (or both).
 *   5. Redeploy — this route starts producing fct_cms_asset_daily rows.
 *
 * Schedule: daily 03:00 UTC (= 08:30 IST), well after YT's daily report
 * window completes around 02:00 UTC. First run after activation creates
 * the Reporting jobs and waits ~24-48h for the first reports to land.
 */

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'cms_reporting', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  try {
    // Dormant guard — no service account JSON means no label has granted
    // access yet. Close as 'ok' with a note so we don't trip alerting.
    if (!env.YT_CMS_SERVICE_ACCOUNT_JSON) {
      await closeRun(supabase, runId, 'ok', 0, 0, {
        note: 'YT_CMS_SERVICE_ACCOUNT_JSON not set — CMS access not yet provisioned by any label',
      });
      return NextResponse.json({ ok: true, skipped: true, run_id: runId });
    }
    if (cmsContentOwnerIds.length === 0) {
      await closeRun(supabase, runId, 'ok', 0, 0, {
        note: 'YT_CMS_CONTENT_OWNER_IDS not set — no per-company mapping configured',
      });
      return NextResponse.json({ ok: true, skipped: true, run_id: runId });
    }

    const sa = parseServiceAccount(env.YT_CMS_SERVICE_ACCOUNT_JSON);

    let totalAssetRowsUpserted = 0;
    let totalRevenueRowsUpserted = 0;
    const perOwnerStats: Array<{
      company: string;
      content_owner_id: string;
      reports_processed: number;
      asset_rows: number;
      revenue_rows: number;
      error?: string;
    }> = [];

    for (const { company, content_owner_id } of cmsContentOwnerIds) {
      const ownerStats = {
        company,
        content_owner_id,
        reports_processed: 0,
        asset_rows: 0,
        revenue_rows: 0,
        error: undefined as string | undefined,
      };
      try {
        const tok = await getAccessToken(sa, content_owner_id);
        // Ensure both reporting jobs exist for this owner
        const existingJobs = await listReportingJobs(tok.access_token, content_owner_id);
        const ensureJob = async (reportTypeId: string): Promise<string> => {
          let job = existingJobs.find((j) => j.reportTypeId === reportTypeId);
          if (!job) {
            job = await createReportingJob(tok.access_token, content_owner_id, reportTypeId);
            await supabase.from('ops_cms_reporting_job').upsert({
              report_type_id: reportTypeId,
              content_owner_id,
              yt_job_id: job.id,
              last_seen_at: new Date().toISOString(),
            }, { onConflict: 'report_type_id,content_owner_id' });
          }
          return job.id;
        };

        const assetJobId = await ensureJob(REPORT_TYPES.asset_basic);
        const revenueJobId = await ensureJob(REPORT_TYPES.asset_revenue);

        // Pull last 7 days of available reports per job — covers backfill
        // gaps and re-delivers if a prior run failed.
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const assetReports = await listReports(tok.access_token, content_owner_id, assetJobId, {
          startTimeAtOrAfter: since,
        });
        const revenueReports = await listReports(
          tok.access_token,
          content_owner_id,
          revenueJobId,
          { startTimeAtOrAfter: since },
        );

        for (const r of assetReports) {
          const rows = await ingestAssetReport(supabase, tok.access_token, r, company, runId);
          ownerStats.asset_rows += rows;
          ownerStats.reports_processed += 1;
        }
        for (const r of revenueReports) {
          const rows = await ingestRevenueReport(supabase, tok.access_token, r, company, runId);
          ownerStats.revenue_rows += rows;
          ownerStats.reports_processed += 1;
        }
        totalAssetRowsUpserted += ownerStats.asset_rows;
        totalRevenueRowsUpserted += ownerStats.revenue_rows;
      } catch (e) {
        ownerStats.error = (e as Error).message;
      }
      perOwnerStats.push(ownerStats);
    }

    const anyError = perOwnerStats.some((s) => s.error);
    const allFailed = perOwnerStats.every((s) => s.error);
    const status: 'ok' | 'partial' | 'failed' = allFailed
      ? 'failed'
      : anyError
        ? 'partial'
        : 'ok';

    await closeRun(
      supabase,
      runId,
      status,
      cmsContentOwnerIds.length,
      totalAssetRowsUpserted + totalRevenueRowsUpserted,
      {
        per_owner: perOwnerStats,
        asset_rows: totalAssetRowsUpserted,
        revenue_rows: totalRevenueRowsUpserted,
      },
    );

    if (totalAssetRowsUpserted > 0 || totalRevenueRowsUpserted > 0) {
      bumpTags(CACHE_TAGS.signals, CACHE_TAGS.overview, CACHE_TAGS.ops);
    }

    return NextResponse.json({
      ok: true,
      run_id: runId,
      content_owners: cmsContentOwnerIds.length,
      asset_rows: totalAssetRowsUpserted,
      revenue_rows: totalRevenueRowsUpserted,
      per_owner: perOwnerStats,
    });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'cms_reporting_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await closeRun(supabase, runId, 'failed', null, null, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function ingestAssetReport(
  supabase: ReturnType<typeof getServiceSupabase>,
  accessToken: string,
  report: ReportEntry,
  company: string,
  runId: number,
): Promise<number> {
  const csv = await downloadReport(accessToken, report.downloadUrl);
  const rows = parseReportingCsv(csv);
  if (rows.length === 0) return 0;
  // Reporting API dimension names per content_owner_asset_basic_a3 spec
  const mapped = rows.map((r) => ({
    date: ytDateToIso(String(r.date)),
    asset_id: String(r.asset_id ?? ''),
    video_id: String(r.video_id ?? ''),
    uploader_type: String(r.uploader_type ?? 'unknown'),
    claimed_status: String(r.claimed_status ?? 'unknown'),
    country_code: String(r.country_code ?? 'ZZ'),
    company,
    views: numOrNull(r.views),
    engaged_views: numOrNull(r.engaged_views),
    watch_time_minutes: numOrNull(r.watch_time_minutes),
    avg_view_duration_seconds: numOrNull(r.average_view_duration_seconds),
    likes: numOrNull(r.likes),
    dislikes: numOrNull(r.dislikes),
    comments: numOrNull(r.comments),
    shares: numOrNull(r.shares),
    red_views: numOrNull(r.red_views),
    red_watch_time_minutes: numOrNull(r.red_watch_time_minutes),
    ingest_run_id: runId,
    updated_at: new Date().toISOString(),
  }));
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += 500) {
    const chunk = mapped.slice(i, i + 500);
    const { error } = await supabase
      .from('fct_cms_asset_daily')
      .upsert(chunk, {
        onConflict: 'date,asset_id,video_id,uploader_type,claimed_status,country_code',
      });
    if (error) throw new Error(`fct_cms_asset_daily upsert: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

async function ingestRevenueReport(
  supabase: ReturnType<typeof getServiceSupabase>,
  accessToken: string,
  report: ReportEntry,
  company: string,
  runId: number,
): Promise<number> {
  const csv = await downloadReport(accessToken, report.downloadUrl);
  const rows = parseReportingCsv(csv);
  if (rows.length === 0) return 0;
  const mapped = rows.map((r) => ({
    date: ytDateToIso(String(r.date)),
    asset_id: String(r.asset_id ?? ''),
    video_id: String(r.video_id ?? ''),
    uploader_type: String(r.uploader_type ?? 'unknown'),
    claimed_status: String(r.claimed_status ?? 'unknown'),
    country_code: String(r.country_code ?? 'ZZ'),
    company,
    estimated_partner_revenue_usd: numOrNull(r.estimated_partner_revenue),
    estimated_partner_ad_revenue_auction_usd: numOrNull(r.estimated_partner_ad_auction_revenue),
    estimated_partner_ad_revenue_reserved_usd: numOrNull(r.estimated_partner_ad_reserved_revenue),
    estimated_partner_red_revenue_usd: numOrNull(r.estimated_partner_red_revenue),
    estimated_partner_transaction_revenue_usd: numOrNull(
      r.estimated_partner_transaction_revenue,
    ),
    ingest_run_id: runId,
    updated_at: new Date().toISOString(),
  }));
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += 500) {
    const chunk = mapped.slice(i, i + 500);
    const { error } = await supabase
      .from('fct_cms_asset_revenue_daily')
      .upsert(chunk, {
        onConflict: 'date,asset_id,video_id,uploader_type,claimed_status,country_code',
      });
    if (error) throw new Error(`fct_cms_asset_revenue_daily upsert: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function closeRun(
  supabase: ReturnType<typeof getServiceSupabase>,
  run_id: number,
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
