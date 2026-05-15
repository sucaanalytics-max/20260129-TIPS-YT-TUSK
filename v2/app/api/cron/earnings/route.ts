import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import { bseScripCodes } from '@/lib/env';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 60;

/**
 * Earnings-announcement ingest.
 *
 * Source: BSE corp-results endpoint. NSE's results feed requires a session
 * cookie dance that's brittle from server-side; BSE serves the data as JSON
 * with a single GET. Cron lands the dates into dim_earnings_event and writes
 * a matching dim_event row keyed by (event_type='earnings', company, date).
 *
 * BSE endpoint shape (observed):
 *   https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strCat=Result&strPrevDate=&strScrip=<code>&strSearch=P&strType=C&subcategory=-1
 *
 * Trailing 30 days of announcements are fetched per scrip on each run; older
 * history seeded via the v1 backfill in /scripts/backfill-from-v1.ts.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'earnings', status: 'running' })
    .select('run_id')
    .single();
  const runId = runRow?.run_id as number | undefined;
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'could not open run' }, { status: 500 });
  }

  const results: Array<{ symbol: string; ok: boolean; events: number; error?: string }> = [];

  for (const { symbol, code } of bseScripCodes) {
    try {
      const rawItems = await fetchBSEEarnings(code);
      // BSE returns multiple announcements per date (board meeting + results +
      // amendments). Dedupe by the upsert keys to avoid intra-batch conflict.
      const items = dedupeBy(rawItems, (it) => `${symbol}|${it.event_date}`);
      if (items.length === 0) {
        results.push({ symbol, ok: true, events: 0 });
        continue;
      }

      const rows = items.map((it) => ({
        symbol,
        event_date: it.event_date,
        period: it.period,
        board_meeting_date: it.board_meeting_date,
        results_pdf_url: it.results_pdf_url,
        source: 'bse',
        meta: { headline: it.headline },
      }));

      const { error: upErr } = await supabase
        .from('dim_earnings_event')
        .upsert(rows, { onConflict: 'symbol,event_date' });
      if (upErr) throw new Error(upErr.message);

      // Mirror into dim_event (dedupe on the dim_event uq key)
      const eventRows = dedupeBy(
        items.map((it) => ({
          event_type: 'earnings',
          event_date: it.event_date,
          label: `${symbol} ${it.period}`.trim(),
          company: symbol,
          meta: { headline: it.headline, results_pdf_url: it.results_pdf_url },
        })),
        (e) => `${e.event_type}|${e.company}|${e.event_date}|${e.label}`,
      );
      await supabase
        .from('dim_event')
        .upsert(eventRows, { onConflict: 'event_type,company,event_date,label' });

      results.push({ symbol, ok: true, events: items.length });
    } catch (e) {
      results.push({ symbol, ok: false, events: 0, error: (e as Error).message });
      await supabase.from('ops_error_log').insert({
        error_type: 'earnings_fetch_failed',
        error_message: (e as Error).message,
        detail: { symbol, code },
        ingest_run_id: runId,
      });
    }
  }

  const totalEvents = results.reduce((s, r) => s + r.events, 0);
  const okCount = results.filter((r) => r.ok).length;
  const status = okCount === results.length ? 'ok' : okCount > 0 ? 'partial' : 'failed';
  await supabase
    .from('ops_ingest_run')
    .update({
      status,
      ended_at: new Date().toISOString(),
      rows_in: results.length,
      rows_out: totalEvents,
      detail: { results },
    })
    .eq('run_id', runId);

  if (totalEvents > 0) bumpTags(CACHE_TAGS.events, CACHE_TAGS.overview, CACHE_TAGS.ops);

  return NextResponse.json({ ok: status !== 'failed', run_id: runId, total_events: totalEvents, results });
}

interface EarningsRow {
  event_date: string;
  period: string;
  board_meeting_date: string | null;
  results_pdf_url: string | null;
  headline: string;
}

async function fetchBSEEarnings(scripCode: string): Promise<EarningsRow[]> {
  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
    `?pageno=1&strCat=Result&strPrevDate=&strScrip=${encodeURIComponent(scripCode)}` +
    `&strSearch=P&strType=C&subcategory=-1`;
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      Referer: 'https://www.bseindia.com/',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`BSE earnings ${scripCode} ${res.status}`);
  const body = (await res.json()) as { Table?: BSEAnnouncementRow[] };
  const rows = body.Table ?? [];

  const out: EarningsRow[] = [];
  for (const r of rows) {
    const headline = (r.HEADLINE ?? r.NEWSSUB ?? '').toString();
    const eventISO = r.NEWS_DT ?? r.AN_DT;
    const event_date = parseISO(eventISO);
    if (!event_date) continue;
    out.push({
      event_date,
      period: detectPeriod(headline),
      board_meeting_date: parseISO(r.AN_DT) ?? null,
      results_pdf_url: r.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${r.ATTACHMENTNAME}`
        : null,
      headline,
    });
  }
  return out;
}

interface BSEAnnouncementRow {
  HEADLINE?: string;
  NEWSSUB?: string;
  NEWS_DT?: string;
  AN_DT?: string;
  ATTACHMENTNAME?: string;
}

// BSE returns "2024-05-08T15:30:00" or "2024-05-08T00:00:00"
function parseISO(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function detectPeriod(headline: string): string {
  const m = headline.match(/(Q[1-4])\s*(?:FY|fy)?\s*(\d{2,4})/i);
  if (m) return `${m[1].toUpperCase()} FY${m[2].slice(-2)}`;
  if (/annual/i.test(headline)) {
    const y = headline.match(/(\d{4})/);
    return y ? `FY${y[1].slice(-2)}` : 'Annual';
  }
  return 'Quarterly';
}

function dedupeBy<T>(rows: T[], keyFn: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const r of rows) map.set(keyFn(r), r);
  return Array.from(map.values());
}
