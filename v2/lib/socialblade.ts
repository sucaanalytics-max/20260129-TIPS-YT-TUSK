import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * Thin wrapper around the SocialBlade Matrix API.
 *
 * Docs (from user): https://socialblade.com/developers/docs
 * Endpoint:  GET https://matrix.sbapis.com/b/youtube/statistics?query={cid|@handle|username}
 * Auth:      clientid + token headers
 *
 * Quota: `default` history = 1 credit per call; `extended` = 2; `archive` = 3.
 * Repeated calls for the same channel within SB's cache TTL (~24h) are free.
 * We always use `allow-stale=true` to maximise cache hits.
 */

const SB = 'https://matrix.sbapis.com';

export interface SBYouTubeResponse {
  status: { success: boolean; status: number; error?: string };
  info?: {
    access?: { seconds_to_expire?: number };
    credits?: { available?: number };
  };
  data?: {
    id: { id: string; username?: string; display_name: string; cusername?: string; handle?: string };
    general?: {
      created_at?: string;
      channel_type?: string;
      geo?: string;
      branding?: { avatar?: string; banner?: string; website?: string };
    };
    statistics?: {
      total?: { uploads?: number; subscribers?: number; views?: number };
      growth?: {
        subs?: Record<string, number>;
        vidviews?: Record<string, number>;
      };
    };
    misc?: {
      grade?: { color?: string; grade?: string };
      sb_verified?: boolean;
      made_for_kids?: boolean;
    };
    ranks?: {
      sbrank?: number;
      subscribers?: number;
      views?: number;
      country?: number;
      channel_type?: number;
    };
    daily?: Array<{ date: string; subs: number; views: number }>;
  };
}

/**
 * Are SB credentials configured? Lets the cron no-op cleanly in dev / before
 * Vercel envs are set.
 */
export function socialBladeConfigured(): boolean {
  return Boolean(env.SOCIALBLADE_CLIENT_ID && env.SOCIALBLADE_TOKEN);
}

/**
 * Fetch one channel's SB statistics snapshot. Default history = 1 credit
 * (cache hits free). Throws on network error or non-200 — caller decides
 * how to log to ops.
 */
export async function fetchSocialBladeChannel(
  channelId: string,
  opts: { history?: 'default' | 'extended' | 'archive' } = {},
): Promise<SBYouTubeResponse> {
  if (!socialBladeConfigured()) {
    throw new Error('SocialBlade credentials not configured');
  }
  const history = opts.history ?? 'default';
  const url = `${SB}/b/youtube/statistics?query=${encodeURIComponent(
    channelId,
  )}&history=${history}&allow-stale=true`;
  const res = await fetchWithRetry(url, {
    headers: {
      clientid: env.SOCIALBLADE_CLIENT_ID as string,
      token: env.SOCIALBLADE_TOKEN as string,
    },
  });
  if (!res.ok) {
    throw new Error(
      `socialblade ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as SBYouTubeResponse;
}

/**
 * Flatten a successful SB response into a row for fct_channel_sb_snapshot.
 * Returns null for the channel's row fields if the response was unsuccessful
 * (e.g. dormant channel SB doesn't index).
 */
export function snapshotRowFromResponse(
  channelId: string,
  asof: string,
  res: SBYouTubeResponse,
  runId: number,
): Record<string, unknown> | null {
  if (!res.status?.success || !res.data) return null;
  const d = res.data;
  const s = d.statistics ?? {};
  const t = s.total ?? {};
  const subsG = s.growth?.subs ?? {};
  const viewsG = s.growth?.vidviews ?? {};
  const ranks = d.ranks ?? {};
  const misc = d.misc ?? {};
  function n(x: number | undefined): number | null {
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
  }
  return {
    channel_id: channelId,
    asof,
    subs_growth_1: n(subsG['1']),
    subs_growth_3: n(subsG['3']),
    subs_growth_7: n(subsG['7']),
    subs_growth_14: n(subsG['14']),
    subs_growth_30: n(subsG['30']),
    subs_growth_60: n(subsG['60']),
    subs_growth_90: n(subsG['90']),
    subs_growth_180: n(subsG['180']),
    subs_growth_365: n(subsG['365']),
    views_growth_1: n(viewsG['1']),
    views_growth_3: n(viewsG['3']),
    views_growth_7: n(viewsG['7']),
    views_growth_14: n(viewsG['14']),
    views_growth_30: n(viewsG['30']),
    views_growth_60: n(viewsG['60']),
    views_growth_90: n(viewsG['90']),
    views_growth_180: n(viewsG['180']),
    views_growth_365: n(viewsG['365']),
    sb_rank: n(ranks.sbrank),
    subs_rank: n(ranks.subscribers),
    views_rank: n(ranks.views),
    country_rank: n(ranks.country),
    channel_type_rank: n(ranks.channel_type),
    grade: misc.grade?.grade ?? null,
    sb_verified: misc.sb_verified ?? null,
    made_for_kids: misc.made_for_kids ?? null,
    total_subscribers: n(t.subscribers),
    total_views: n(t.views),
    total_uploads: n(t.uploads),
    ingest_run_id: runId,
  };
}

export function creditsRemaining(res: SBYouTubeResponse): number | null {
  return res.info?.credits?.available ?? null;
}
