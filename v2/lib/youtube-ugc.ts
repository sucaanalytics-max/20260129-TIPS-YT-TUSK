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
