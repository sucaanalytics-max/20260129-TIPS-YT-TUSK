import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { closeRun, logError, openRun } from '@/lib/ingest-run';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/fetch-with-retry';

/**
 * One-shot seed for dim_company + dim_channel.
 *
 * Idempotent — uses upsert on the PK. Run once after applying baseline schema:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<v2-domain>/api/cron/seed
 *
 * Re-running is safe and will refresh display_name / language fields if they
 * drift. The first /api/cron/youtube-channels invocation backfills
 * dim_channel.uploads_playlist_id from the YT API.
 */
export const maxDuration = 60;

const COMPANIES = [
  { company: 'TIPSMUSIC', display_name: 'Tips Industries Ltd', nse_symbol: 'TIPSMUSIC' },
  { company: 'SAREGAMA', display_name: 'Saregama India Ltd', nse_symbol: 'SAREGAMA' },
];

// 38 channels — sourced from v1 api/seed-channels.js, language inferred from
// channel name where obvious. Languages use ISO 639-1 where possible.
const CHANNELS = [
  // -- TIPSMUSIC (15) --
  { channel_id: 'UCJrDMFOdv1I2k8n9oK_V21w', channel_name: 'Tips Official',            company: 'TIPSMUSIC', handle: 'tipsofficial',           language: 'hi' },
  { channel_id: 'UC37cflt9I_ER6Z0YQUdJGBw', channel_name: "90's Gaane",                company: 'TIPSMUSIC', handle: '90sgaane',                language: 'hi' },
  { channel_id: 'UC9h5YEjla8WeIIsifbf84_Q', channel_name: 'Volume',                    company: 'TIPSMUSIC', handle: 'volume',                  language: 'hi' },
  { channel_id: 'UCF8Ar7alYrtOI5SF6b7T0xA', channel_name: 'Tips Punjabi',              company: 'TIPSMUSIC', handle: 'tipspunjabi',             language: 'pa' },
  { channel_id: 'UC2V5vzgmEmoiWqXfM2jN5_w', channel_name: 'Tips Telugu',               company: 'TIPSMUSIC', handle: 'tipstelugu',              language: 'te' },
  { channel_id: 'UCFNHLC4euNaQGDmIokMugiA', channel_name: 'Tips Jhankaar Gaane',       company: 'TIPSMUSIC', handle: 'jhankargaane',            language: 'hi' },
  { channel_id: 'UCOn5Bj5jcQkVpx7pzxP3PDw', channel_name: 'Evergreen Bollywood Hits',  company: 'TIPSMUSIC', handle: 'evergreenbollywoodhitss', language: 'hi' },
  { channel_id: 'UCCbmKsQJ92JV-L8jYJ4u9Yg', channel_name: 'Tips Bhakti Prem',          company: 'TIPSMUSIC', handle: 'tipsbhaktiprem',          language: 'hi' },
  { channel_id: 'UCqXO3ktBw0D0sw1z5hZFeDg', channel_name: 'Tips Films',                company: 'TIPSMUSIC', handle: 'tipsfilms',               language: 'hi' },
  { channel_id: 'UCwhvGgGNRm18Gv9cHSbwNtw', channel_name: 'Bollywood Sadabahar',       company: 'TIPSMUSIC', handle: 'bollywoodsadabahar',      language: 'hi' },
  { channel_id: 'UC48pE7QE4NZFTCsHT-IRxJw', channel_name: 'Tips Tamil',                company: 'TIPSMUSIC', handle: 'tipstamil',               language: 'ta' },
  { channel_id: 'UCTHUx9uIBkpy8Z9OiKzMz0A', channel_name: 'Tips Bhojpuri',             company: 'TIPSMUSIC', handle: 'tipsbhojpuri',            language: 'bho' },
  { channel_id: 'UCCOygJTrBqQbClJKLoKgKfw', channel_name: 'Tips Haryanvi',             company: 'TIPSMUSIC', handle: 'tipsharyanvi',            language: 'bgc' },
  { channel_id: 'UCbIHXx0FVQCXG1fhkgnJINw', channel_name: 'Tips Gujarati',             company: 'TIPSMUSIC', handle: 'tipsgujarati',            language: 'gu' },
  { channel_id: 'UCdKTnvHFf67M1UrW3qbe-Dg', channel_name: 'Tips Marathi',              company: 'TIPSMUSIC', handle: 'tipsmarathi',             language: 'mr' },

  // -- SAREGAMA (23) --
  { channel_id: 'UC_A7K2dXFsTMAciGmnNxy-Q', channel_name: 'Saregama',                         company: 'SAREGAMA', handle: 'saregamamusic',              language: 'hi' },
  { channel_id: 'UC0J8BQahplvTY6LjlnLf_NQ', channel_name: 'Saregama Bhojpuri',                company: 'SAREGAMA', handle: 'saregamahumbhojpuri',        language: 'bho' },
  { channel_id: 'UCtrovMbRR6h_XLMfdbhqb1A', channel_name: 'Saregama TV Shows Tamil',          company: 'SAREGAMA', handle: 'saregamatvshowstamil',       language: 'ta' },
  { channel_id: 'UC68nKdrLbLL0Vj7ilVkLmmg', channel_name: 'Saregama Telugu',                  company: 'SAREGAMA', handle: 'saregamatelugu',             language: 'te' },
  { channel_id: 'UCzee67JnEcuvjErRyWP3GpQ', channel_name: 'Saregama Tamil',                   company: 'SAREGAMA', handle: 'saregamatamil',              language: 'ta' },
  { channel_id: 'UCRh-4WUJx8M86gUYL2pyKSQ', channel_name: 'Saregama Bengali',                 company: 'SAREGAMA', handle: 'saregamabengali',            language: 'bn' },
  { channel_id: 'UCoRF8GByEjmM_yHwUGIDGyQ', channel_name: 'Saregama Malayalam',               company: 'SAREGAMA', handle: 'saregamamalayalam',          language: 'ml' },
  { channel_id: 'UCJSX0gNr2U5lawLXE6IjRmA', channel_name: 'Saregama Marathi',                 company: 'SAREGAMA', handle: 'saregamamarathi',            language: 'mr' },
  { channel_id: 'UCKFnbjBQDzzh002TMJcyuZA', channel_name: 'Saregama Kannada',                 company: 'SAREGAMA', handle: 'saregamakannada',            language: 'kn' },
  { channel_id: 'UC6vQRTCxutg6fJLUGkDKynQ', channel_name: 'Saregama Bhakti',                  company: 'SAREGAMA', handle: 'saregamabhakti',             language: 'hi' },
  { channel_id: 'UCvrD1eyGgo8O9JcTraCvYBg', channel_name: 'Saregama Gujarati',                company: 'SAREGAMA', handle: 'saregamagujarati',           language: 'gu' },
  { channel_id: 'UCSdWkYk9pk3DHTXbof_R7XQ', channel_name: 'Saregama Punjabi',                 company: 'SAREGAMA', handle: 'saregamapunjabi',            language: 'pa' },
  { channel_id: 'UCcfQ2IQNVoAb7znCP2dlIqw', channel_name: 'Saregama Ghazal',                  company: 'SAREGAMA', handle: 'saregamaghazal',             language: 'ur' },
  { channel_id: 'UCpQiC_zElVHhNm58uwCi7Gw', channel_name: 'Saregama Karaoke',                 company: 'SAREGAMA', handle: 'saregamakaraoke',            language: null },
  { channel_id: 'UC6-4EXwd60J6cfJPttOHd3A', channel_name: 'Saregama Carnatic',                company: 'SAREGAMA', handle: 'saregamacarnatic',           language: 'hi' },
  { channel_id: 'UC7KNSypmtecKCEXpmtyh8jQ', channel_name: 'Saregama Kids',                    company: 'SAREGAMA', handle: 'saregamakids',               language: null },
  { channel_id: 'UC76TspUE4-LJgLN-7JCcUvg', channel_name: 'Saregama Sufi',                    company: 'SAREGAMA', handle: 'saregamasufi',               language: 'ur' },
  { channel_id: 'UCZZSschh7IG4n0jCj9zD55w', channel_name: 'Saregama Regional',                company: 'SAREGAMA', handle: 'saregamaregional',           language: null },
  { channel_id: 'UCgo7B-9h9MsXXV8B8oQKzgw', channel_name: 'Saregama Movies',                  company: 'SAREGAMA', handle: 'saregamamovies',             language: 'hi' },
  { channel_id: 'UCjm_2mMYXUEjWzSVsA6Wshg', channel_name: 'Saregama Hindustani Classical',    company: 'SAREGAMA', handle: 'saregamahindustaniclassical', language: 'hi' },
  { channel_id: 'UCEb756VyJmgWoHLbhBD76_w', channel_name: 'Saregama Assamese',                company: 'SAREGAMA', handle: 'saregamaassamese',           language: 'as' },
  { channel_id: 'UC_HNOL9DxoF8aYYN3kDv2Eg', channel_name: 'Saregama Haryanvi',                company: 'SAREGAMA', handle: 'saregamaharyanvi',           language: 'bgc' },
  { channel_id: 'UCeyLWXudxRp7d8JiG-nGq1w', channel_name: 'Yoodlee Films',                    company: 'SAREGAMA', handle: 'yoodleefilms',               language: 'hi' },
];

// ---- Saregama IR-cockpit additions ----------------------------------------
//
// Channels whose ID we still need to resolve via YT Data API at seed time.
// channels.list?forHandle costs 1 quota unit and is idempotent — safe to call
// every seed run. If resolution fails the row is skipped and an entry is
// written to ops_error_log so the next manual seed can disambiguate.
const SAREGAMA_RESOLVE: Array<{
  channel_name: string;
  company: string;
  handle: string;
  language: string | null;
  meta: Record<string, unknown>;
}> = [
  {
    channel_name: 'Saregama Carvaan',
    company: 'SAREGAMA',
    handle: 'SaregamaCarvaan-h8u',
    language: null,
    meta: { kind: 'product', note: 'promo channel for Saregama Carvaan device' },
  },
];

// Taxonomy backfill for already-seeded Saregama channels. Keyed by channel_id
// so we don't re-encode the CHANNELS array. The dim_channel.meta column was
// added in migration 0007.
const META_BACKFILL: Record<string, Record<string, unknown>> = {
  'UCtrovMbRR6h_XLMfdbhqb1A': { kind: 'tv_shows' },           // Saregama TV Shows Tamil
  'UC6vQRTCxutg6fJLUGkDKynQ': { genre: 'devotional' },        // Saregama Bhakti
  'UCcfQ2IQNVoAb7znCP2dlIqw': { genre: 'ghazal' },             // Saregama Ghazal
  'UCpQiC_zElVHhNm58uwCi7Gw': { kind: 'karaoke' },             // Saregama Karaoke
  'UC6-4EXwd60J6cfJPttOHd3A': { genre: 'carnatic' },           // Saregama Carnatic
  'UC7KNSypmtecKCEXpmtyh8jQ': { kind: 'kids' },                // Saregama Kids
  'UC76TspUE4-LJgLN-7JCcUvg': { genre: 'sufi' },               // Saregama Sufi
  'UCgo7B-9h9MsXXV8B8oQKzgw': { kind: 'movies' },              // Saregama Movies
  'UCjm_2mMYXUEjWzSVsA6Wshg': { genre: 'hindustani' },         // Saregama Hindustani Classical
  'UCeyLWXudxRp7d8JiG-nGq1w': { kind: 'films' },               // Yoodlee Films
};

/**
 * Resolve a YT @handle to a channel_id via channels.list?forHandle (1 unit).
 * Returns null if the handle doesn't resolve to exactly one channel.
 */
async function resolveHandle(handle: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;
  const j = (await res.json()) as { items?: Array<{ id: string }> };
  if (!j.items || j.items.length !== 1) return null;
  return j.items[0].id;
}

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const { run_id } = await openRun(supabase, 'seed');

  try {
    // Companies first (dim_channel.company → dim_company FK)
    const { error: coErr } = await supabase
      .from('dim_company')
      .upsert(COMPANIES, { onConflict: 'company' });
    if (coErr) throw new Error(`dim_company upsert: ${coErr.message}`);

    const { error: chErr } = await supabase
      .from('dim_channel')
      .upsert(CHANNELS, { onConflict: 'channel_id' });
    if (chErr) throw new Error(`dim_channel upsert: ${chErr.message}`);

    // ---- Meta taxonomy backfill (idempotent, targets existing rows only) ---
    let metaUpdated = 0;
    for (const [channelId, meta] of Object.entries(META_BACKFILL)) {
      const { error: mErr } = await supabase
        .from('dim_channel')
        .update({ meta })
        .eq('channel_id', channelId);
      if (mErr) {
        await logError(supabase, {
          error_type: 'seed_meta_update_failed',
          error_message: mErr.message,
          ingest_run_id: run_id,
          detail: { channel_id: channelId },
        });
      } else {
        metaUpdated += 1;
      }
    }

    // ---- Resolve channels with unknown IDs (handle → UC…) ------------------
    let resolved = 0;
    let unresolved = 0;
    for (const r of SAREGAMA_RESOLVE) {
      try {
        const channelId = await resolveHandle(r.handle);
        if (!channelId) {
          unresolved += 1;
          await logError(supabase, {
            error_type: 'seed_ambiguous_channel',
            error_message: `forHandle=${r.handle} did not resolve to a single channel`,
            ingest_run_id: run_id,
            detail: { name: r.channel_name, handle: r.handle, company: r.company },
          });
          continue;
        }
        const { error: rErr } = await supabase.from('dim_channel').upsert(
          {
            channel_id: channelId,
            channel_name: r.channel_name,
            company: r.company,
            handle: r.handle,
            language: r.language,
            meta: r.meta,
          },
          { onConflict: 'channel_id' },
        );
        if (rErr) {
          await logError(supabase, {
            error_type: 'seed_resolve_upsert_failed',
            error_message: rErr.message,
            ingest_run_id: run_id,
            detail: { name: r.channel_name, channel_id: channelId },
          });
          unresolved += 1;
        } else {
          resolved += 1;
        }
      } catch (err) {
        unresolved += 1;
        await logError(supabase, {
          error_type: 'seed_resolve_failed',
          error_message: (err as Error).message,
          ingest_run_id: run_id,
          detail: { name: r.channel_name, handle: r.handle },
        });
      }
    }

    const totalChannels = CHANNELS.length + resolved;

    await closeRun(supabase, {
      run_id,
      status: unresolved > 0 ? 'partial' : 'ok',
      rows_in: COMPANIES.length + CHANNELS.length + SAREGAMA_RESOLVE.length,
      rows_out: COMPANIES.length + totalChannels,
      detail: {
        companies: COMPANIES.length,
        channels: CHANNELS.length,
        meta_updated: metaUpdated,
        resolved,
        unresolved,
      },
    });

    return NextResponse.json({
      success: true,
      companies: COMPANIES.length,
      channels: totalChannels,
      meta_updated: metaUpdated,
      resolved,
      unresolved,
      run_id,
    });
  } catch (err) {
    const e = err as Error;
    await logError(supabase, {
      error_type: 'seed_failed',
      error_message: e.message,
      ingest_run_id: run_id,
      detail: { stack: e.stack },
    });
    await closeRun(supabase, {
      run_id,
      status: 'failed',
      detail: { error: e.message },
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// Allow GET for ergonomic browser/curl testing (still gated by Bearer)
export const GET = POST;
