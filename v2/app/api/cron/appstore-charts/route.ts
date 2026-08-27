import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { DSP_APPS, TRACKED_COUNTRY } from '@/lib/dsp';
import { fetchAppleAppsChart, fetchAppleMusicChart, matchCatalogArtist } from '@/lib/app-intel';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 120;

/**
 * Daily Apple chart ingest for India (free, legitimate):
 *
 *   1. Apps Top-Free chart → resolve each tracked DSP app's rank into
 *      fct_app_proxy_daily (source 'apple_rss'). Note: v2 RSS has no category
 *      filter and caps at 50, so music apps frequently rank below the cutoff →
 *      rank may be null. Best-effort.
 *
 *   2. Music "most-played" songs chart → fct_catalog_chart_presence, flagging
 *      entries whose credited artist matches the labels' catalog
 *      (dim_artist_label). This is the LEGAL substitute for DSP playlist-
 *      placement tracking (Spotify editorial access is closed to new apps;
 *      JioSaavn/Gaana scraping is ToS-risky). A directional catalog-demand
 *      signal, graded LOW.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const country = TRACKED_COUNTRY;

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'appstore_charts', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  try {
    // ---- 1. Apps Top-Free → DSP app ranks --------------------------------
    let appRowsUpserted = 0;
    const appsChart = await fetchAppleAppsChart(country, 'top-free', 50);
    const rankById = new Map<string, number>();
    for (const e of appsChart) if (e.id) rankById.set(e.id, e.rank);
    const appRows = DSP_APPS.filter((a) => a.app_store_id).map((a) => ({
      dsp: a.dsp,
      store: 'app_store',
      country,
      date: today,
      source: 'apple_rss',
      chart_kind: 'apps_top_free',
      chart_rank: rankById.get(a.app_store_id as string) ?? null,
      ingest_run_id: runId,
    }));
    if (appRows.length > 0) {
      const { error } = await supabase
        .from('fct_app_proxy_daily')
        .upsert(appRows, { onConflict: 'dsp,store,country,date,source' });
      if (error) throw new Error(`apps upsert: ${error.message}`);
      appRowsUpserted = appRows.length;
    }

    // ---- 2. Music most-played → catalog presence -------------------------
    const { data: labelArtists } = await supabase
      .from('dim_artist_label')
      .select('artist_name, company');
    const catalog = (labelArtists ?? []) as Array<{ artist_name: string; company: string }>;
    const catalogArtists = catalog.map((c) => c.artist_name);
    const companyByArtist = new Map(catalog.map((c) => [c.artist_name, c.company]));

    const songChart = await fetchAppleMusicChart(country, 'songs', 50);
    const presenceRows = songChart.map((e) => {
      const matched = matchCatalogArtist(e.artist_name, catalogArtists);
      return {
        chart: 'apple_music_songs',
        country,
        date: today,
        rank: e.rank,
        track_title: e.name,
        artist: e.artist_name,
        is_catalog_match: matched != null,
        matched_artist: matched,
        matched_company: matched ? companyByArtist.get(matched) ?? null : null,
        source: 'apple_rss',
        ingest_run_id: runId,
      };
    });
    let presenceUpserted = 0;
    const matches = presenceRows.filter((r) => r.is_catalog_match).length;
    if (presenceRows.length > 0) {
      const { error } = await supabase
        .from('fct_catalog_chart_presence')
        .upsert(presenceRows, { onConflict: 'chart,country,date,rank' });
      if (error) throw new Error(`presence upsert: ${error.message}`);
      presenceUpserted = presenceRows.length;
    }

    await closeRun(supabase, runId, 'ok', appsChart.length + songChart.length, appRowsUpserted + presenceUpserted, {
      app_ranks: appRowsUpserted,
      chart_entries: presenceUpserted,
      catalog_matches: matches,
    });
    bumpTags(CACHE_TAGS.market, CACHE_TAGS.ops);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      app_ranks: appRowsUpserted,
      chart_entries: presenceUpserted,
      catalog_matches: matches,
    });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'appstore_charts_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await closeRun(supabase, runId, 'failed', null, null, { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function closeRun(
  supabase: ReturnType<typeof getServiceSupabase>,
  run_id: number,
  status: 'ok' | 'partial' | 'failed',
  rows_in: number | null,
  rows_out: number | null,
  detail: Record<string, unknown>,
) {
  await supabase
    .from('ops_ingest_run')
    .update({ ended_at: new Date().toISOString(), status, rows_in, rows_out, detail })
    .eq('run_id', run_id);
}
