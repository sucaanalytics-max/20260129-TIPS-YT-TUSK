import 'server-only';
import { revalidateTag } from 'next/cache';

/**
 * Cache-tag profile used for ingest-triggered invalidation. 'max' is what
 * Next's own deprecation warning recommends when the intent is "purge this tag
 * now" rather than "re-time it" — the cron has just landed newer rows, so the
 * cached render is simply wrong and should not be served again.
 */
const PURGE_PROFILE = 'max';

export interface BumpResult {
  ok: string[];
  failed: Array<{ tag: string; error: string }>;
}

/**
 * Wrapper so cron routes can fan out cache invalidation after a successful
 * ingest without each route re-importing next/cache. Catches its own errors —
 * a failed revalidation must never roll back a successful upsert.
 *
 * Next 16 (verified against next@16.2.6 source, not docs from memory):
 *   - updateTag(tag)              → Server Actions ONLY. Throws anywhere else.
 *   - revalidateTag(tag, profile) → the Route Handler API. `profile` is
 *                                   required; omitting it warns.
 *
 * This previously called updateTag() from route handlers, which threw on every
 * single cron run from 2026-06-16 to 2026-08-27 (~146 recorded failures). The
 * ingest kept succeeding, so rows landed in Supabase — but no dashboard page
 * was ever invalidated, which is why the UI looked frozen while the database
 * was current. The swallowed error is what let it hide for two months, so the
 * outcome is now returned for callers/health checks to surface.
 */
export function bumpTags(...tags: string[]): BumpResult {
  const result: BumpResult = { ok: [], failed: [] };
  for (const tag of tags) {
    try {
      revalidateTag(tag, PURGE_PROFILE);
      result.ok.push(tag);
    } catch (err) {
      const message = (err as Error).message;
      result.failed.push({ tag, error: message });
      console.error(`revalidateTag(${tag}) failed: ${message}`);
    }
  }
  return result;
}

export const CACHE_TAGS = {
  overview: 'overview',
  channels: 'channels',
  videos: 'videos',
  stock: 'stock',
  correlation: 'correlation',
  events: 'events',
  ops: 'ops',
  signals: 'signals',
  rank: 'rank',
  market: 'market',
  nowcast: 'nowcast',
} as const;
