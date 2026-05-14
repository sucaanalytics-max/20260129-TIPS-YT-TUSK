import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * Thin wrapper around YouTube Data API v3. We use raw fetch (not googleapis)
 * to keep cold-start latency and bundle size low — we only need 2 endpoints.
 *
 * Quota cost reference:
 *   channels.list   1 unit per call, up to 50 IDs per call
 *   playlistItems.list 1 unit per call, up to 50 items per call
 *   videos.list     1 unit per call, up to 50 IDs per call
 *   search.list     100 units per call — AVOID unless necessary
 * Default quota: 10,000 units/day per API key.
 */

const YT = 'https://www.googleapis.com/youtube/v3';
const BATCH = 50;

export interface YTChannel {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    publishedAt: string;
    country?: string;
  };
  statistics: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  contentDetails: {
    relatedPlaylists: { uploads: string };
  };
}

export interface YTVideo {
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    liveBroadcastContent?: string;
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    favoriteCount?: string;
  };
  contentDetails: {
    duration: string; // ISO 8601 PT#M#S
    definition?: string;
  };
}

/** Batches up to 50 ids per call. Returns one item per id found. */
export async function fetchChannels(channelIds: string[]): Promise<YTChannel[]> {
  const out: YTChannel[] = [];
  for (let i = 0; i < channelIds.length; i += BATCH) {
    const chunk = channelIds.slice(i, i + BATCH);
    const url = `${YT}/channels?part=snippet,statistics,contentDetails&id=${chunk.join(',')}&maxResults=${BATCH}&key=${env.YOUTUBE_API_KEY}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`channels.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { items: YTChannel[] };
    out.push(...(j.items ?? []));
  }
  return out;
}

/** Up to 50 videos per call. */
export async function fetchVideos(videoIds: string[]): Promise<YTVideo[]> {
  const out: YTVideo[] = [];
  for (let i = 0; i < videoIds.length; i += BATCH) {
    const chunk = videoIds.slice(i, i + BATCH);
    const url = `${YT}/videos?part=snippet,statistics,contentDetails&id=${chunk.join(',')}&maxResults=${BATCH}&key=${env.YOUTUBE_API_KEY}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`videos.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { items: YTVideo[] };
    out.push(...(j.items ?? []));
  }
  return out;
}

/** Walks the uploads playlist for a channel, newest first. Stops at `limit` items. */
export async function fetchUploadIds(
  uploadsPlaylistId: string,
  limit = 200,
): Promise<{ videoId: string; publishedAt: string }[]> {
  const out: { videoId: string; publishedAt: string }[] = [];
  let pageToken: string | undefined;
  while (out.length < limit) {
    const url =
      `${YT}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}` +
      `&maxResults=${BATCH}&key=${env.YOUTUBE_API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`playlistItems.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as {
      items: { contentDetails: { videoId: string; videoPublishedAt?: string } }[];
      nextPageToken?: string;
    };
    for (const it of j.items ?? []) {
      if (out.length >= limit) break;
      out.push({
        videoId: it.contentDetails.videoId,
        publishedAt: it.contentDetails.videoPublishedAt ?? '',
      });
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
