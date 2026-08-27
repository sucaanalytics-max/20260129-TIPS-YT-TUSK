import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { DSP_APPS, TRACKED_COUNTRY } from '@/lib/dsp';
import { fetchItunesLookup, fetchPlayApp } from '@/lib/app-intel';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 120;

/**
 * Daily app-ratings / install snapshot for the tracked DSP apps in India.
 *
 *   - iOS  → iTunes Lookup (per-country cumulative rating count + average).
 *   - Android → google-play-scraper (install bucket + rating count), optional;
 *     no-ops cleanly if the package isn't installed or the layout broke.
 *
 * One row per (dsp, store, country, date, source). These are GROSS demand
 * proxies, not paid subscribers — graded LOW downstream. Per-app failures are
 * logged but never fail the whole run (mirrors the SocialBlade cron posture).
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const country = TRACKED_COUNTRY;

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'app_ratings', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  const rows: Record<string, unknown>[] = [];
  const perApp: Array<{ dsp: string; ios?: string; android?: string }> = [];
  let playAvailable = false;

  try {
    for (const app of DSP_APPS) {
      const status: { dsp: string; ios?: string; android?: string } = { dsp: app.dsp };

      if (app.app_store_id) {
        try {
          const r = await fetchItunesLookup(app.app_store_id, country);
          if (r) {
            rows.push({
              dsp: app.dsp,
              store: 'app_store',
              country,
              date: today,
              source: 'itunes_lookup',
              rating_count: r.rating_count,
              rating_avg: r.rating_avg,
              ingest_run_id: runId,
            });
            status.ios = 'ok';
          } else {
            status.ios = 'empty';
          }
        } catch (e) {
          status.ios = `err:${(e as Error).message.slice(0, 60)}`;
        }
      }

      if (app.play_package) {
        const p = await fetchPlayApp(app.play_package, country);
        playAvailable = playAvailable || p.available;
        if (p.available && !p.not_found) {
          rows.push({
            dsp: app.dsp,
            store: 'play_store',
            country,
            date: today,
            source: 'play_scraper',
            rating_count: p.rating_count,
            rating_avg: p.rating_avg,
            install_bucket: p.install_bucket,
            min_installs: p.min_installs,
            ingest_run_id: runId,
          });
          status.android = 'ok';
        } else {
          status.android = p.available ? 'not_found' : 'pkg_absent';
        }
      }

      perApp.push(status);
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase
        .from('fct_app_proxy_daily')
        .upsert(chunk, { onConflict: 'dsp,store,country,date,source' });
      if (error) throw new Error(`upsert: ${error.message}`);
      upserted += chunk.length;
    }

    const status: 'ok' | 'partial' = upserted > 0 ? 'ok' : 'partial';
    await closeRun(supabase, runId, status, DSP_APPS.length, upserted, {
      play_available: playAvailable,
      per_app: perApp,
    });
    if (upserted > 0) bumpTags(CACHE_TAGS.market, CACHE_TAGS.ops);

    return NextResponse.json({ ok: true, run_id: runId, upserted, play_available: playAvailable, per_app: perApp });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'app_ratings_failed',
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
