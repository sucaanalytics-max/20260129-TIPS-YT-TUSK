import 'server-only';
import { createSign } from 'node:crypto';

/**
 * YouTube CMS / Content Owner Reporting API client.
 *
 * Dormant until env.YT_CMS_SERVICE_ACCOUNT_JSON is provisioned by a label.
 * Then this module handles:
 *   1. Service-account JWT signing → OAuth access token (RS256)
 *   2. Listing the available report jobs (jobs.list) for a content owner
 *   3. Creating a job if missing (jobs.create) for the report types we need
 *   4. Polling for daily report URLs (jobs.reports.list)
 *   5. Downloading the gzipped CSV via signed URL
 *
 * Scopes required (granted by the label via CMS Manager onboarding):
 *   https://www.googleapis.com/auth/yt-analytics.readonly
 *   https://www.googleapis.com/auth/youtubepartner-content-owner-readonly
 *
 * Reports we target:
 *   content_owner_asset_basic_a3
 *   content_owner_asset_estimated_revenue_a1
 *
 * Caller responsibility: validate that env.YT_CMS_SERVICE_ACCOUNT_JSON is
 * non-empty before importing the active functions — they throw otherwise.
 */

const YT_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_REPORTING_API = 'https://youtubereporting.googleapis.com/v1';

const SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtubepartner-content-owner-readonly',
].join(' ');

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface ReportingJob {
  id: string;
  reportTypeId: string;
  name?: string;
  createTime?: string;
  systemManaged?: boolean;
}

export interface ReportEntry {
  id: string;
  jobId: string;
  startTime: string;
  endTime: string;
  createTime: string;
  downloadUrl: string;
}

/**
 * Parse the JSON blob from env.YT_CMS_SERVICE_ACCOUNT_JSON. Throws if the
 * blob is missing required fields — callers should guard with
 * `if (env.YT_CMS_SERVICE_ACCOUNT_JSON)` before invoking.
 */
export function parseServiceAccount(blob: string): ServiceAccount {
  const sa = JSON.parse(blob) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error('service account JSON missing client_email or private_key');
  }
  return sa as ServiceAccount;
}

/**
 * Exchange a service-account JWT for an OAuth access token. Standard
 * Google "JWT Bearer" flow — no library dependency, just Node crypto.
 */
export async function getAccessToken(
  sa: ServiceAccount,
  contentOwnerId?: string,
): Promise<{ access_token: string; expires_in: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES,
      aud: sa.token_uri ?? YT_OAUTH_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      // YT Partner API supports passing the content owner via the JWT's
      // `sub` claim in some flows; we add it for safety when present.
      ...(contentOwnerId ? { sub: contentOwnerId } : {}),
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(sa.private_key);
  const sigB64 = sig
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = `${signingInput}.${sigB64}`;

  const res = await fetch(sa.token_uri ?? YT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`oauth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * List Reporting API jobs registered for a content owner. Returns the
 * currently-active jobs (we de-duplicate against ops_cms_reporting_job
 * upstream).
 */
export async function listReportingJobs(
  accessToken: string,
  contentOwnerId: string,
): Promise<ReportingJob[]> {
  const url =
    `${YT_REPORTING_API}/jobs` +
    `?onBehalfOfContentOwner=${encodeURIComponent(contentOwnerId)}` +
    `&includeSystemManaged=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`jobs.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { jobs?: ReportingJob[] };
  return data.jobs ?? [];
}

/**
 * Create a Reporting API job for the given reportTypeId. YT backfills
 * ~30 days on the first job for that report type per content owner.
 */
export async function createReportingJob(
  accessToken: string,
  contentOwnerId: string,
  reportTypeId: string,
): Promise<ReportingJob> {
  const url =
    `${YT_REPORTING_API}/jobs` +
    `?onBehalfOfContentOwner=${encodeURIComponent(contentOwnerId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reportTypeId,
      name: `tusk-${reportTypeId}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`jobs.create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as ReportingJob;
}

/**
 * List daily reports available for a job. Each entry includes a
 * downloadUrl pointing at the gzipped CSV. URLs expire — caller should
 * fetch them within the same hour.
 */
export async function listReports(
  accessToken: string,
  contentOwnerId: string,
  jobId: string,
  opts: { startTimeAtOrAfter?: string; pageSize?: number } = {},
): Promise<ReportEntry[]> {
  const params = new URLSearchParams({
    onBehalfOfContentOwner: contentOwnerId,
    pageSize: String(opts.pageSize ?? 100),
  });
  if (opts.startTimeAtOrAfter) {
    params.set('startTimeAtOrAfter', opts.startTimeAtOrAfter);
  }
  const url = `${YT_REPORTING_API}/jobs/${encodeURIComponent(jobId)}/reports?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `jobs.reports.list ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { reports?: ReportEntry[] };
  return data.reports ?? [];
}

/**
 * Download a CSV report. Returns raw CSV text (the API returns it as
 * plain CSV when `alt=media` is implied via the downloadUrl).
 *
 * Note: the downloadUrl includes auth tokens, but we still send the
 * Authorization header for safety.
 */
export async function downloadReport(
  accessToken: string,
  downloadUrl: string,
): Promise<string> {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`download ${res.status}`);
  }
  return await res.text();
}

/**
 * Parse a YouTube Reporting CSV. First row is the header; subsequent
 * rows are records. Numeric columns are coerced to numbers; dates stay
 * as strings (YYYYMMDD format).
 */
export function parseReportingCsv(csv: string): Array<Record<string, string | number>> {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const rows: Array<Record<string, string | number>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length !== headers.length) continue;
    const row: Record<string, string | number> = {};
    for (let j = 0; j < headers.length; j++) {
      const v = cells[j];
      const asNum = Number(v);
      row[headers[j]] =
        v !== '' && !Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(v) ? asNum : v;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Map a YT date dimension (YYYYMMDD) to ISO YYYY-MM-DD for our schema.
 */
export function ytDateToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Report-type IDs we care about. Add new entries here when expanding
 * the dataset (e.g., demographic or device reports).
 */
export const REPORT_TYPES = {
  asset_basic: 'content_owner_asset_basic_a3',
  asset_revenue: 'content_owner_asset_estimated_revenue_a1',
} as const;
