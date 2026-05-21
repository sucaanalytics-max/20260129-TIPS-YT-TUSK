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
  label: string | null;
  song: string | null;
  artist: string | null;
}

/**
 * Fetch the watch page for a UGC video and parse the "Music in this video"
 * panel from ytInitialData. Returns:
 *   - kind='content_id' when the panel surfaces an explicit
 *     "Licensed to YouTube by ..." claim (i.e., the audio is matched via
 *     Content ID and the label is earning ad-share revenue)
 *   - kind='sound_ref' when the panel is absent but the video has a
 *     "Sound" reference back to another video (Shorts-sound system; label
 *     still earns via Shorts Creator Fund share, but through a different
 *     mechanism than Content ID)
 *   - kind='none' otherwise (no detectable music attribution)
 *
 * Cost: 1 HTTP fetch per video, no YT API quota.
 */
export async function fetchMusicAttribution(videoId: string): Promise<MusicAttribution> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    cache: 'no-store',
  });
  if (!res.ok) {
    return { kind: 'none', label: null, song: null, artist: null };
  }
  const html = await res.text();
  const m = html.match(/var ytInitialData\s*=\s*({[\s\S]+?});\s*<\/script>/);
  if (!m) return { kind: 'none', label: null, song: null, artist: null };
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { kind: 'none', label: null, song: null, artist: null };
  }

  // The music panel is usually under engagementPanels →
  // engagementPanelSectionListRenderer → content →
  // structuredDescriptionContentRenderer → items → an item whose
  // videoDescriptionMusicSectionRenderer contains the carouselLockups.
  // YT also surfaces the same info via horizontalCardListRenderer.
  // We walk the tree generically to find the first carouselLockup-shaped
  // node that has song/artist/label text.
  const carousel = findCarouselLockup(data);
  if (carousel) {
    return {
      kind: 'content_id',
      song: carousel.song,
      artist: carousel.artist,
      label: carousel.label,
    };
  }

  // Fall-back: Shorts watch pages sometimes expose "Sound" attribution via
  // a separate renderer (reelPlayerHeaderRenderer.reelTitleOnClickCommand
  // → reelWatchEndpoint of the source video).
  if (findShortsSoundRef(data)) {
    return { kind: 'sound_ref', label: null, song: null, artist: null };
  }

  return { kind: 'none', label: null, song: null, artist: null };
}

interface CarouselLockup {
  song: string | null;
  artist: string | null;
  label: string | null;
}

function findCarouselLockup(node: unknown): CarouselLockup | null {
  let found: CarouselLockup | null = null;
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    // Older shape: videoDescriptionMusicSectionRenderer.carouselLockups[]
    const sect = o.videoDescriptionMusicSectionRenderer as
      | { carouselLockups?: unknown[] }
      | undefined;
    if (sect?.carouselLockups?.length) {
      const lockup = sect.carouselLockups[0] as Record<string, unknown> | undefined;
      // Lockup contains videoLockupViewModel or carouselLockupRenderer
      const inner =
        (lockup?.carouselLockupRenderer as Record<string, unknown> | undefined) ??
        (lockup as Record<string, unknown> | undefined);
      const parsed = parseCarousel(inner);
      if (parsed) {
        found = parsed;
        return;
      }
    }
    // Newer shape: horizontalCardListRenderer with cards[] each carrying
    // videoAttributeViewModel.title, secondaryText, tertiaryText etc.
    if (o.horizontalCardListRenderer) {
      const list = o.horizontalCardListRenderer as { cards?: unknown[] };
      const first = list.cards?.[0] as Record<string, unknown> | undefined;
      const parsed = parseCarousel(first);
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

function parseCarousel(node: Record<string, unknown> | undefined): CarouselLockup | null {
  if (!node) return null;
  // Common shape: { infoRows: [ { infoRowRenderer: { title: {simpleText}, defaultMetadata: {simpleText} } } ] }
  // Each row has a label like "Song", "Artist", "Licensed to YouTube by"
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
    else if (t.includes('licensed to youtube by') || t.includes('licensed by') || t.includes('record label')) {
      label = value;
    }
  }
  if (song || artist || label) return { song, artist, label };
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
 * Caller is responsible for providing the YOUTUBE_API_KEY.
 */
export async function enrichUGCVideos(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, UGCEnrichment>> {
  const out = new Map<string, UGCEnrichment>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=snippet,contentDetails,statistics&id=${batch.join(',')}&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) continue;
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
