import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import { stockSymbols } from '@/lib/env';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 60;

/**
 * Corporate actions ingest (NSE).
 *
 * For each configured symbol pulls the corporate-actions feed, parses
 * SPLIT / BONUS / DIVIDEND into dim_corporate_action keyed by
 * (symbol, ex_date, action_type), then calls recompute_adjusted_close
 * so fct_adjusted_price_daily is continuous through the new ex-date.
 *
 * Also writes one dim_event row per action so the event-study overlay sees it.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const { data: runRow } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'corporate_actions', status: 'running' })
    .select('run_id')
    .single();
  const runId = runRow?.run_id as number | undefined;
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'could not open run' }, { status: 500 });
  }

  const results: Array<{ symbol: string; actions: number; ok: boolean; error?: string }> = [];

  try {
    for (const symbol of stockSymbols) {
      try {
        const rawActions = await fetchNSECorporateActions(symbol);
        // NSE returns multiple records for the same (symbol, ex_date, action_type)
        // when an action is announced+amended; Postgres rejects ON CONFLICT
        // batches with intra-batch dupes. Keep last seen (most recently parsed).
        const actions = dedupeBy(rawActions, (a) => `${a.symbol}|${a.ex_date}|${a.action_type}`);
        if (actions.length === 0) {
          results.push({ symbol, actions: 0, ok: true });
          continue;
        }

        const { error: upsertErr } = await supabase
          .from('dim_corporate_action')
          .upsert(actions, { onConflict: 'symbol,ex_date,action_type' });
        if (upsertErr) throw new Error(`dim_corporate_action: ${upsertErr.message}`);

        // Mirror into dim_event so the event-study sees splits/bonuses/divs
        const eventRows = dedupeBy(
          actions.map((a) => ({
            event_type: a.action_type,
            event_date: a.ex_date,
            label: buildEventLabel(a),
            company: companyForSymbol(symbol),
            meta: { ratio_num: a.ratio_num, ratio_den: a.ratio_den, cash_per_share: a.cash_per_share },
          })),
          (e) => `${e.event_type}|${e.company}|${e.event_date}|${e.label}`,
        );
        await supabase
          .from('dim_event')
          .upsert(eventRows, { onConflict: 'event_type,company,event_date,label' });

        // Re-derive adjusted_close
        const { data: rpc, error: rpcErr } = await supabase.rpc('recompute_adjusted_close', { target_symbol: symbol });
        if (rpcErr) throw new Error(`recompute_adjusted_close: ${rpcErr.message}`);
        const rpcRow = Array.isArray(rpc) ? rpc[0] : rpc;

        results.push({
          symbol,
          actions: actions.length,
          ok: true,
        });
        await supabase.from('ops_ingest_run').update({
          detail: { last_symbol: symbol, recomputed_rows: rpcRow?.rows_written ?? null },
        }).eq('run_id', runId);
      } catch (e) {
        results.push({ symbol, actions: 0, ok: false, error: (e as Error).message });
        await supabase.from('ops_error_log').insert({
          error_type: 'corporate_actions_symbol_failed',
          error_message: (e as Error).message,
          detail: { symbol },
          ingest_run_id: runId,
        });
      }
    }

    const totalActions = results.reduce((s, r) => s + r.actions, 0);
    const status = results.every((r) => r.ok) ? 'ok' : results.some((r) => r.ok) ? 'partial' : 'failed';
    await supabase
      .from('ops_ingest_run')
      .update({
        status,
        ended_at: new Date().toISOString(),
        rows_in: results.length,
        rows_out: totalActions,
        detail: { results },
      })
      .eq('run_id', runId);

    if (totalActions > 0) bumpTags(CACHE_TAGS.stock, CACHE_TAGS.events, CACHE_TAGS.overview, CACHE_TAGS.ops);

    return NextResponse.json({ ok: status !== 'failed', run_id: runId, total_actions: totalActions, results });
  } catch (err) {
    const message = (err as Error).message;
    await supabase.from('ops_error_log').insert({
      error_type: 'corporate_actions_ingest_failed',
      error_message: message,
      detail: { stack: (err as Error).stack },
      ingest_run_id: runId,
    });
    await supabase
      .from('ops_ingest_run')
      .update({ status: 'failed', ended_at: new Date().toISOString(), detail: { error: message } })
      .eq('run_id', runId);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface CorporateAction {
  symbol: string;
  ex_date: string;
  action_type: 'split' | 'bonus' | 'dividend' | 'rights' | 'merger';
  ratio_num: number | null;
  ratio_den: number | null;
  cash_per_share: number | null;
  record_date: string | null;
  meta: Record<string, unknown>;
}

async function fetchNSECorporateActions(symbol: string): Promise<CorporateAction[]> {
  const url = `https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`NSE corp-actions ${symbol} ${res.status}`);
  const body = (await res.json()) as unknown;
  const items = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
  const out: CorporateAction[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const parsed = parseAction(symbol, raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseAction(symbol: string, raw: Record<string, unknown>): CorporateAction | null {
  const purpose = String(raw.subject ?? raw.purpose ?? '').toLowerCase();
  const exDateRaw = (raw.exDate ?? raw.ex_date) as string | undefined;
  if (!exDateRaw) return null;
  const ex_date = parseNSEDate(exDateRaw);
  if (!ex_date) return null;

  let action_type: CorporateAction['action_type'];
  let ratio_num: number | null = null;
  let ratio_den: number | null = null;
  let cash_per_share: number | null = null;

  if (purpose.includes('stock split') || purpose.includes('face value split') || purpose.includes('sub-division')) {
    action_type = 'split';
    const r = extractRatio(purpose) ?? extractFaceValueSplit(purpose);
    if (r) ({ ratio_num, ratio_den } = r);
  } else if (purpose.includes('bonus')) {
    action_type = 'bonus';
    const r = extractRatio(purpose);
    if (r) ({ ratio_num, ratio_den } = r);
  } else if (purpose.includes('dividend')) {
    action_type = 'dividend';
    cash_per_share = extractDividend(purpose);
  } else if (purpose.includes('rights')) {
    action_type = 'rights';
  } else if (purpose.includes('merger') || purpose.includes('amalgamation') || purpose.includes('scheme of arrangement')) {
    action_type = 'merger';
  } else {
    return null;
  }

  return {
    symbol,
    ex_date,
    action_type,
    ratio_num,
    ratio_den,
    cash_per_share,
    record_date: parseNSEDate(raw.recDate as string | undefined),
    meta: { purpose, raw },
  };
}

// "11-Sep-2024" → "2024-09-11"
function parseNSEDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const mm = months[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]}`;
}

// "Bonus 1:5" or "Stock Split From Rs.10/- To Rs.2/-" or "Dividend - Rs 1.00 Per Share"
function extractRatio(text: string): { ratio_num: number; ratio_den: number } | null {
  const m = text.match(/(\d+)\s*[:/]\s*(\d+)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!a || !b) return null;
  return { ratio_num: a, ratio_den: b };
}

// "from rs.10/- to rs.2/-" → ratio 8:2 (8 new for every 2 held → 4:1 split)
function extractFaceValueSplit(text: string): { ratio_num: number; ratio_den: number } | null {
  const m = text.match(/from\s+(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?).*?to\s+(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!from || !to || to >= from) return null;
  // 10 → 2 means each share becomes 5; ratio_num = (5-1) new for every 1 held = 4, den = 1
  // Generally: new shares per old = from/to. Bonus-equivalent ratio = (from/to - 1) : 1.
  const factor = from / to;
  return { ratio_num: factor - 1, ratio_den: 1 };
}

function extractDividend(text: string): number | null {
  const m = text.match(/(?:rs\.?|inr)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function buildEventLabel(a: CorporateAction): string {
  if (a.action_type === 'split' || a.action_type === 'bonus') {
    return `${a.action_type} ${a.ratio_num ?? '?'}:${a.ratio_den ?? '?'}`;
  }
  if (a.action_type === 'dividend' && a.cash_per_share != null) {
    return `dividend ₹${a.cash_per_share}/sh`;
  }
  return a.action_type;
}

function companyForSymbol(symbol: string): string {
  return symbol;
}

/** Keep last occurrence per key. Required because Postgres rejects ON CONFLICT
 *  upsert batches where multiple rows share the same conflict key. */
function dedupeBy<T>(rows: T[], keyFn: (r: T) => string): T[] {
  const map = new Map<string, T>();
  for (const r of rows) map.set(keyFn(r), r);
  return Array.from(map.values());
}
