/**
 * UGC (User-Generated Content) discovery via YouTube's public sound-pivot
 * pages. For each anchor video in the catalog, /source/{videoId}/shorts
 * returns the Shorts that use that video's audio as their sound.
 *
 * The endpoint returns a finite sample (~few hundred lockups per sound, even
 * for sounds with millions of uses) — not a complete enumeration. Good
 * enough for "is this catalog track driving UGC growth" trend signal; NOT
 * good enough for absolute revenue modelling (use CMS / Pex for that).
 *
 * No YT Data API quota cost. Just public HTML + JSON-in-script-tag parsing.
 */

const SHORTS_PIVOT_URL = (videoId: string) =>
  `https://www.youtube.com/source/${videoId}/shorts`;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface ShortMatch {
  ugc_video_id: string;
  view_count: number | null;
  view_count_text: string | null;
  channel_name: string | null;
  raw_meta: Record<string, unknown>;
}

/**
 * Fetch + parse the Shorts pivot page for a given anchor video.
 * Returns the list of UGC Shorts using that anchor's audio.
 *
 * Throws on network error or non-200. Returns [] if the page parses but
 * has no Shorts lockups (e.g., the source has no UGC uses, or YT changed
 * the response shape).
 */
export async function fetchShortsForSound(
  sourceVideoId: string,
): Promise<ShortMatch[]> {
  const url = SHORTS_PIVOT_URL(sourceVideoId);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    // Avoid Next.js fetch-caching this — we want fresh data each cron run.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`shorts pivot ${res.status} for ${sourceVideoId}`);
  }
  const html = await res.text();
  const m = html.match(/var ytInitialData\s*=\s*({[\s\S]+?});\s*<\/script>/);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const lockups = collectShortsLockups(data);
  return lockups.map(parseLockup).filter((m): m is ShortMatch => m != null);
}

interface ShortsLockup {
  entityId?: string;
  accessibilityText?: string;
  onTap?: {
    innertubeCommand?: {
      reelWatchEndpoint?: { videoId?: string };
      commandMetadata?: { webCommandMetadata?: { url?: string } };
    };
  };
}

/**
 * Walk the parsed ytInitialData tree and collect every shortsLockupViewModel.
 * YouTube nests these under several rendererings (richItemRenderer →
 * reelShelfRenderer → reelItemRenderer, plus the newer flat layout). A
 * generic walker avoids hardcoding the path, which YT changes regularly.
 */
function collectShortsLockups(node: unknown): ShortsLockup[] {
  const out: ShortsLockup[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.shortsLockupViewModel && typeof o.shortsLockupViewModel === 'object') {
        out.push(o.shortsLockupViewModel as ShortsLockup);
      }
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(node);
  return out;
}

/**
 * Parse an accessibility text like:
 *   "Vijay 😈 thalapathy CM mukhymantri Chennai Tamil Nadu, 1.9 thousand views – play Short"
 * into { channel_name, view_count, view_count_text }.
 *
 * Accessibility format is descriptive prose, not a strict schema. We use
 * positional heuristics: the view count phrase is always near the end as
 * "<n> <thousand|million|billion>? views". Channel name / title precedes it.
 */
function parseAccessibility(text: string): {
  view_count: number | null;
  view_count_text: string | null;
  channel_name: string | null;
} {
  if (!text) return { view_count: null, view_count_text: null, channel_name: null };
  // Match the view-count phrase. Examples:
  //   "1.9 thousand views"  "5.2 million views"  "423 views"  "1.4K views"
  const viewMatch = text.match(
    /([\d,]+(?:\.\d+)?)\s*(thousand|million|billion|K|M|B)?\s*views/i,
  );
  let view_count: number | null = null;
  let view_count_text: string | null = null;
  if (viewMatch) {
    view_count_text = viewMatch[0];
    const num = parseFloat(viewMatch[1].replace(/,/g, ''));
    const scale = (viewMatch[2] || '').toLowerCase();
    const mult =
      scale === 'thousand' || scale === 'k'
        ? 1_000
        : scale === 'million' || scale === 'm'
          ? 1_000_000
          : scale === 'billion' || scale === 'b'
            ? 1_000_000_000
            : 1;
    if (Number.isFinite(num)) view_count = Math.round(num * mult);
  }

  // Everything before the view-count phrase is title+channel mishmash. We
  // can't reliably split which is which from the accessibility text alone,
  // so we keep the full pre-views chunk as channel_name proxy. A future
  // pass via videos.list?id= can resolve real channel info.
  let channel_name: string | null = null;
  if (viewMatch && viewMatch.index != null) {
    const before = text.slice(0, viewMatch.index).trim().replace(/,$/, '').trim();
    channel_name = before || null;
  }

  return { view_count, view_count_text, channel_name };
}

// ---------------------------------------------------------------------------
// I3: Music-panel attribution scraping
// ---------------------------------------------------------------------------

export interface MusicAttribution {
  kind: 'content_id' | 'sound_ref' | 'none';
  song: string | null;
  artist: string | null;
  // Linked source-audio video ID when present. Maps to the master audio
  // upload that YT's Content ID matched against. Resolve to label via
  // a downstream dim_video JOIN.
  source_video_id: string | null;
  // The old "Licensed to YouTube by ..." string. Modern panels (post
  // ~2025-Q4) no longer expose this — left in the type for back-compat
  // with infoRowRenderer-shaped panels still appearing on long-form
  // videos. Will be null for most Shorts.
  label: string | null;
}

/**
 * Fetch the watch page for a UGC video and parse the music-attribution
 * panel from ytInitialData. Supports two shapes:
 *
 *   1. Modern (videoAttributeViewModel) — used on Shorts and increasingly
 *      on long-form. Exposes title (song), subtitle (artist), and an
 *      onTap.watchEndpoint.videoId pointing to the source audio video.
 *      Label name is NOT in this shape.
 *   2. Legacy (videoDescriptionMusicSectionRenderer → infoRows) — used on
 *      older long-form watch pages. Exposes "Song", "Artist", "Licensed
 *      to YouTube by" rows. Label name IS available here.
 *
 * Returns:
 *   - kind='content_id' when either shape is found (label may be null if
 *     only the modern shape was present)
 *   - kind='sound_ref' for Shorts using YT's sound-system (no music panel
 *     but a reelPlayerHeaderRenderer / source link is present)
 *   - kind='none' otherwise
 */
export async function fetchMusicAttribution(videoId: string): Promise<MusicAttribution> {
  const empty: MusicAttribution = {
    kind: 'none',
    song: null,
    artist: null,
    source_video_id: null,
    label: null,
  };
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    cache: 'no-store',
  });
  if (!res.ok) return empty;
  const html = await res.text();
  const m = html.match(/var ytInitialData\s*=\s*({[\s\S]+?});\s*<\/script>/);
  if (!m) return empty;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return empty;
  }

  // Try modern shape first (videoAttributeViewModel)
  const modern = findVideoAttribute(data);
  if (modern) return { ...modern, kind: 'content_id' };

  // Fall back to legacy infoRows shape
  const legacy = findLegacyCarousel(data);
  if (legacy) return { ...legacy, kind: 'content_id' };

  // No music panel, but Shorts may have a sound-reference renderer
  if (findShortsSoundRef(data)) {
    return { ...empty, kind: 'sound_ref' };
  }
  return empty;
}

interface AttributionFields {
  song: string | null;
  artist: string | null;
  source_video_id: string | null;
  label: string | null;
}

/**
 * Walk the tree looking for a videoAttributeViewModel. This is the modern
 * shape used on Shorts and increasingly on long-form watch pages. It
 * carries title (song), subtitle (artist), and a deep link to the source
 * audio video via onTap.innertubeCommand.watchEndpoint.videoId.
 */
function findVideoAttribute(node: unknown): AttributionFields | null {
  let found: AttributionFields | null = null;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.videoAttributeViewModel && typeof o.videoAttributeViewModel === 'object') {
      const v = o.videoAttributeViewModel as Record<string, unknown>;
      const song = typeof v.title === 'string' ? v.title : null;
      const artist = typeof v.subtitle === 'string' ? v.subtitle : null;
      const tap = v.onTap as
        | { innertubeCommand?: { watchEndpoint?: { videoId?: string } } }
        | undefined;
      const sourceVid = tap?.innertubeCommand?.watchEndpoint?.videoId ?? null;
      if (song || artist || sourceVid) {
        found = { song, artist, source_video_id: sourceVid, label: null };
        return;
      }
    }
    for (const val of Object.values(o)) walk(val);
  };
  walk(node);
  return found;
}

/**
 * Legacy shape (infoRows under videoDescriptionMusicSectionRenderer).
 * Still present on some older long-form videos. Carries the label name.
 */
function findLegacyCarousel(node: unknown): AttributionFields | null {
  let found: AttributionFields | null = null;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const sect = o.videoDescriptionMusicSectionRenderer as
      | { carouselLockups?: unknown[] }
      | undefined;
    if (sect?.carouselLockups?.length) {
      const lockup = sect.carouselLockups[0] as Record<string, unknown> | undefined;
      const inner =
        (lockup?.carouselLockupRenderer as Record<string, unknown> | undefined) ??
        lockup;
      const parsed = parseLegacyCarousel(inner);
      if (parsed) {
        found = parsed;
        return;
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(node);
  return found;
}

function parseLegacyCarousel(
  node: Record<string, unknown> | undefined,
): AttributionFields | null {
  if (!node) return null;
  const findInfoRows = (n: unknown): unknown[] => {
    if (!n) return [];
    if (Array.isArray(n)) return n.flatMap(findInfoRows);
    if (typeof n !== 'object') return [];
    const o = n as Record<string, unknown>;
    if (Array.isArray(o.infoRows)) return o.infoRows;
    return Object.values(o).flatMap(findInfoRows);
  };
  const rows = findInfoRows(node);
  let song: string | null = null;
  let artist: string | null = null;
  let label: string | null = null;
  for (const r of rows) {
    const ir = (r as Record<string, unknown>).infoRowRenderer as
      | Record<string, unknown>
      | undefined;
    if (!ir) continue;
    const title = simpleText(ir.title);
    const value = simpleText(ir.defaultMetadata) ?? simpleText(ir.expandedMetadata);
    if (!title || !value) continue;
    const t = title.toLowerCase();
    if (t.includes('song')) song = value;
    else if (t.includes('artist')) artist = value;
    else if (
      t.includes('licensed to youtube by') ||
      t.includes('licensed by') ||
      t.includes('record label')
    ) {
      label = value;
    }
  }
  if (song || artist || label) {
    return { song, artist, source_video_id: null, label };
  }
  return null;
}

function simpleText(node: unknown): string | null {
  if (!node) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) {
      return (o.runs as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    }
  }
  return null;
}

function findShortsSoundRef(node: unknown): boolean {
  let hit = false;
  const walk = (n: unknown): void => {
    if (hit || n == null) return;
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.reelPlayerHeaderRenderer || o.reelPlayerBadge) {
      hit = true;
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(node);
  return hit;
}

// ---------------------------------------------------------------------------
// I1: Batch enrichment via videos.list
// ---------------------------------------------------------------------------

export interface UGCEnrichment {
  ugc_video_id: string;
  channel_id: string | null;
  channel_name: string | null;
  title: string | null;
  description: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  is_short: boolean | null;
  licensed_content: boolean | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
}

interface YTVideoItem {
  id: string;
  snippet?: {
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
  };
  contentDetails?: { duration?: string; licensedContent?: boolean };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

/**
 * Batch videos.list?id= for up to 50 IDs per call. Returns enriched
 * metadata indexed by ugc_video_id. Costs 1 quota unit per 50 IDs.
 *
 * Caller is responsible for providing the YOUTUBE_API_KEY. Per-batch
 * errors are appended to `errors` (caller can log to ops_error_log)
 * rather than throwing — partial enrichment is preferable to none.
 */
export async function enrichUGCVideos(
  videoIds: string[],
  apiKey: string,
  errors?: Array<{ batch_start: number; status: number; message: string }>,
): Promise<Map<string, UGCEnrichment>> {
  const out = new Map<string, UGCEnrichment>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=snippet,contentDetails,statistics&id=${batch.join(',')}&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (errors) {
        const body = await res.text().catch(() => '');
        errors.push({ batch_start: i, status: res.status, message: body.slice(0, 200) });
      }
      continue;
    }
    const data = (await res.json()) as { items?: YTVideoItem[] };
    for (const it of data.items ?? []) {
      const dur = parseDurationSeconds(it.contentDetails?.duration);
      const isShort = dur != null ? dur <= 60 : null;
      out.set(it.id, {
        ugc_video_id: it.id,
        channel_id: it.snippet?.channelId ?? null,
        channel_name: it.snippet?.channelTitle ?? null,
        title: it.snippet?.title ?? null,
        description: it.snippet?.description ?? null,
        published_at: it.snippet?.publishedAt ?? null,
        duration_seconds: dur,
        is_short: isShort,
        licensed_content: it.contentDetails?.licensedContent ?? null,
        view_count:
          it.statistics?.viewCount != null ? Number(it.statistics.viewCount) : null,
        like_count: it.statistics?.likeCount != null ? Number(it.statistics.likeCount) : null,
        comment_count:
          it.statistics?.commentCount != null ? Number(it.statistics.commentCount) : null,
      });
    }
  }
  return out;
}

function parseDurationSeconds(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, h = '0', mi = '0', s = '0'] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s);
}

/**
 * Lightweight videos.list batch that only resolves channel info — used
 * for the attribution_source_video_id resolution path where we don't
 * care about statistics or contentDetails, just `whose channel is this
 * master-audio video on?`
 *
 * 1 quota unit per 50 IDs (same cost as enrichUGCVideos).
 */
export async function resolveVideoChannels(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, { channel_id: string | null; channel_name: string | null }>> {
  const out = new Map<string, { channel_id: string | null; channel_name: string | null }>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=snippet&id=${batch.join(',')}&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) continue;
    const data = (await res.json()) as { items?: YTVideoItem[] };
    for (const it of data.items ?? []) {
      out.set(it.id, {
        channel_id: it.snippet?.channelId ?? null,
        channel_name: it.snippet?.channelTitle ?? null,
      });
    }
  }
  return out;
}

function parseLockup(l: ShortsLockup): ShortMatch | null {
  const ugcId = l.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
  if (!ugcId) return null;
  const acc = l.accessibilityText ?? '';
  const parsed = parseAccessibility(acc);
  return {
    ugc_video_id: ugcId,
    view_count: parsed.view_count,
    view_count_text: parsed.view_count_text,
    channel_name: parsed.channel_name,
    raw_meta: {
      accessibility_text: acc,
      entity_id: l.entityId ?? null,
    },
  };
}
