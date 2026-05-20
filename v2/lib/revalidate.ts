import 'server-only';
import { updateTag } from 'next/cache';

/**
 * Wrapper around updateTag so cron routes can fan out invalidation after a
 * successful ingest without each route re-importing next/cache. Catches its
 * own errors — a failed revalidation should never roll back a successful
 * upsert.
 *
 * Next 16: updateTag(tag) for simple tag invalidation; revalidateTag(tag,
 * profile) requires a cacheLife profile and is meant for Server Actions.
 */
export function bumpTags(...tags: string[]): void {
  for (const tag of tags) {
    try {
      updateTag(tag);
    } catch (err) {
      console.error(`updateTag(${tag}) failed: ${(err as Error).message}`);
    }
  }
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
} as const;
