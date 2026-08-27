import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * Public app-intelligence proxies for the India music-streaming demand layer.
 *
 * Reliable, legitimate, free sources (no API key):
 *   - Apple iTunes Lookup  — per-country cumulative rating count + average
 *     (e.g. Spotify IN ≈4.87m ratings). Best high-frequency demand proxy.
 *   - Apple RSS Marketing feeds — Top Free / Top Paid apps charts and the
 *     "most-played" music (songs/albums) charts, BY COUNTRY.
 *   - Google Play (optional) — install bucket + rating count via the
 *     `google-play-scraper` package, dynamically imported so its absence (or
 *     a layout-break, since it's unmaintained) degrades to a no-op.
 *
 * ⚠️ Caveat baked into the model: these are GROSS funnel-top demand signals,
 * never paid-subscriber counts. Downloads/ratings are cumulative and never
 * decrement for churn. Graded LOW; not bias-weighted into the IR READ.
 */

const APPLE_RSS = 'https://rss.marketingtools.apple.com/api/v2';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

// ---------------------------------------------------------------------------
// Pure parse helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Parse a Google Play install bucket string ("500,000,000+") into its lower
 * bound. Returns null for unparseable input.
 */
export function parseInstallBucket(text: string | null | undefined): {
  bucket: string | null;
  min: number | null;
} {
  if (!text) return { bucket: null, min: null };
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return { bucket: text, min: null };
  return { bucket: text, min: Number(digits) };
}

/** Normalise an artist/track name for catalog matching (case/space/diacritics). */
export function normaliseName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Does a chart entry's artist match any of the label's catalog artists?
 * Substring match on normalised names (chart credits often list several
 * artists, e.g. "Cheema Y, Gur Sidhu"). Returns the matched catalog artist or
 * null.
 */
export function matchCatalogArtist(
  chartArtist: string | null | undefined,
  catalogArtists: string[],
): string | null {
  const hay = normaliseName(chartArtist);
  if (!hay) return null;
  for (const a of catalogArtists) {
    const needle = normaliseName(a);
    if (needle && hay.includes(needle)) return a;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apple — iTunes Lookup (per-country ratings)
// ---------------------------------------------------------------------------

export interface ItunesLookupResult {
  app_store_id: string;
  track_name: string | null;
  rating_count: number | null;      // lifetime, this storefront
  rating_avg: number | null;
  primary_genre: string | null;
}

export async function fetchItunesLookup(
  appStoreId: string,
  country = 'IN',
): Promise<ItunesLookupResult | null> {
  const url = `${ITUNES_LOOKUP}?id=${encodeURIComponent(appStoreId)}&country=${country.toLowerCase()}`;
  const res = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`itunes lookup ${res.status}`) as Error & { httpStatus: number };
    err.httpStatus = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    resultCount: number;
    results: Array<{
      trackName?: string;
      userRatingCount?: number;
      averageUserRating?: number;
      primaryGenreName?: string;
    }>;
  };
  const r = json.results?.[0];
  if (!r) return null;
  return {
    app_store_id: appStoreId,
    track_name: r.trackName ?? null,
    rating_count: typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
    rating_avg: typeof r.averageUserRating === 'number' ? r.averageUserRating : null,
    primary_genre: r.primaryGenreName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Apple — RSS marketing feeds (charts by country)
// ---------------------------------------------------------------------------

export interface AppleChartEntry {
  rank: number;        // 1-based position in the feed
  id: string | null;
  name: string | null;
  artist_name: string | null;
}

async function fetchAppleFeed(path: string): Promise<AppleChartEntry[]> {
  const url = `${APPLE_RSS}/${path}`;
  const res = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`apple rss ${res.status} (${path})`) as Error & { httpStatus: number };
    err.httpStatus = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    feed?: { results?: Array<{ id?: string; name?: string; artistName?: string }> };
  };
  const results = json.feed?.results ?? [];
  return results.map((r, i) => ({
    rank: i + 1,
    id: r.id ?? null,
    name: r.name ?? null,
    artist_name: r.artistName ?? null,
  }));
}

/** Apps Top Free / Top Paid for a country (note: v2 has no top-grossing for apps). */
export function fetchAppleAppsChart(
  country = 'IN',
  chart: 'top-free' | 'top-paid' = 'top-free',
  limit: 10 | 25 | 50 = 50,
): Promise<AppleChartEntry[]> {
  return fetchAppleFeed(`${country.toLowerCase()}/apps/${chart}/${limit}/apps.json`);
}

/** Music "most-played" songs / albums for a country (for catalog-presence). */
export function fetchAppleMusicChart(
  country = 'IN',
  kind: 'songs' | 'albums' = 'songs',
  limit: 10 | 25 | 50 = 50,
): Promise<AppleChartEntry[]> {
  return fetchAppleFeed(`${country.toLowerCase()}/music/most-played/${limit}/${kind}.json`);
}

// ---------------------------------------------------------------------------
// Google Play (optional, fragile) — dynamic import so absence is a no-op
// ---------------------------------------------------------------------------

export interface PlayAppResult {
  available: boolean;   // is google-play-scraper installed?
  not_found?: boolean;  // package present but app id 404'd
  install_bucket: string | null;
  min_installs: number | null;
  rating_count: number | null;
  rating_avg: number | null;
}

export async function fetchPlayApp(
  packageId: string,
  country = 'IN',
): Promise<PlayAppResult> {
  // Variable specifier keeps TS from statically resolving the optional dep.
  const specifier = 'google-play-scraper';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any = null;
  try {
    mod = await import(specifier);
  } catch {
    return { available: false, install_bucket: null, min_installs: null, rating_count: null, rating_avg: null };
  }
  const gplay = mod?.default ?? mod;
  try {
    const app = await gplay.app({ appId: packageId, country: country.toLowerCase() });
    const { bucket, min } = parseInstallBucket(app.installs);
    return {
      available: true,
      install_bucket: bucket,
      min_installs: min ?? (typeof app.minInstalls === 'number' ? app.minInstalls : null),
      rating_count: typeof app.ratings === 'number' ? app.ratings : null,
      rating_avg: typeof app.score === 'number' ? app.score : null,
    };
  } catch {
    return { available: true, not_found: true, install_bucket: null, min_installs: null, rating_count: null, rating_avg: null };
  }
}
