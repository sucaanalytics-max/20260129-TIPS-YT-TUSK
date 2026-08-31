/**
 * Cumulative-view delta computation with frozen-plateau repair.
 *
 * YouTube's Data API intermittently serves a STALE cumulative viewCount: the
 * identical number for consecutive days, across every channel at once, then it
 * unfreezes and the whole backlog lands in one reading. Observed on
 * 2026-05-21, 2026-06-24, and consecutively on 2026-08-02/03 (~2% of days).
 *
 * The naive delta records the stall as a factual 0 and the backlog as one
 * enormous day. That is wrong twice over: a 0 asserts "nobody watched", which
 * is certainly false, and the catch-up day reads as a genuine spike (the real
 * 2026-08-04 landed at +11.5 sigma).
 *
 * The rule here:
 *   - a zero delta means we learned NOTHING today -> null, never 0
 *   - when the plateau breaks, the backlog is spread evenly across the days it
 *     actually covers, every affected row flagged `imputed` with the true
 *     `delta_span_days`
 *
 * That is interpolation across a known aggregate, not invented data: the sum is
 * preserved exactly, and `total_views` (the raw API reading) is never touched.
 * Callers must surface the flag rather than pass imputed days off as measured.
 */

/**
 * Per-channel, per-DAY plausibility ceiling. Above this a delta is treated as a
 * YouTube-side catalog restatement rather than viewership: on 2026-06-06
 * Saregama's main channel jumped +1,018,606,658 in a single reading against a
 * ~21-25M/day baseline.
 *
 * Critically this is tested against the per-day RATE, not the raw delta. A long
 * freeze produces a large catch-up whose daily share is perfectly ordinary
 * (a 5-day stall on a 45M/day channel arrives as +225M), and discarding that
 * would throw away real data.
 *
 * This comment used to claim the rate ceiling kept every repair below the
 * fct_channel_daily CHECK constraint. It does not, and that gap took the
 * channel ingest down for four days: where rows are missing the delta is stored
 * WHOLE, so the value written is the rate times the span, and any span of three
 * or more days can clear 500m while passing a 200m/day rate test. Every write
 * was then rejected, which widened the gap, which lengthened the next span — a
 * failure that could not recover on its own.
 *
 * So there are two ceilings now and they mean different things. The RATE
 * ceiling asks "is this a believable number of views per day?". The STORABLE
 * ceiling asks "will the database accept this row?" and must equal the CHECK
 * constraint exactly. A value may pass the first and fail the second.
 */
export const MAX_PLAUSIBLE_DAILY_VIEWS = 200_000_000;

/**
 * Mirrors `fct_channel_daily_daily_views_check`: daily_views must be NULL, or
 * >= 0 and < 500,000,000. Anything at or above this is left UNKNOWN rather than
 * written, because a rejected row loses the whole batch it travels in.
 */
export const MAX_STORABLE_DAILY_VIEWS = 500_000_000;

export interface DeltaPoint {
  date: string;               // YYYY-MM-DD, ascending
  total_views: number | null; // cumulative, as reported
}

export interface DeltaResult {
  date: string;
  daily_views: number | null;
  imputed: boolean;
  /** Days the underlying cumulative delta actually covered. 1 = ordinary day. */
  delta_span_days: number | null;
}

export function computeDailyViews(series: DeltaPoint[]): DeltaResult[] {
  const out: DeltaResult[] = series.map((p) => ({
    date: p.date,
    daily_views: null,
    imputed: false,
    delta_span_days: null,
  }));

  // `frozen[i]` marks a row whose cumulative reading did not move at all. Those
  // are the days a later delta has to be shared back across.
  const frozen = new Array<boolean>(series.length).fill(false);

  for (let i = 1; i < series.length; i++) {
    const cur = series[i].total_views;
    const prev = series[i - 1].total_views;
    if (cur == null || prev == null) continue; // nothing computable either way

    const dv = cur - prev;

    if (dv === 0) {
      frozen[i] = true; // pending: resolved when the plateau breaks
      continue;
    }
    if (dv < 0) {
      // Counter reset / upstream correction — unknowable, and it breaks the
      // run: days pending before it must never be resolved by a later delta.
      clearRunBefore(frozen, i);
      continue;
    }

    // Walk back over the immediately preceding frozen rows.
    let k = 0;
    while (i - 1 - k >= 0 && frozen[i - 1 - k]) k++;
    const rowsCovered = k + 1;

    // The span is what the delta REALLY covers, measured in calendar days from
    // the last usable reading — not the number of rows we happen to hold. Rows
    // can be missing entirely (an ingest outage), and calling a 9-day delta a
    // 1-day one is the same error this module exists to fix.
    const span = daysBetween(series[i - rowsCovered].date, series[i].date) || rowsCovered;

    // Plausibility is judged on the per-day rate, so a long stall is repaired
    // rather than discarded. Above the ceiling this is a restatement: leave the
    // whole span unknown and strand the frozen days rather than invent views.
    if (dv / span > MAX_PLAUSIBLE_DAILY_VIEWS) {
      clearRunBefore(frozen, i);
      continue;
    }

    // An even split is only available when we hold a row for every day the
    // delta covers. Where rows are missing we keep the value whole (so the
    // total is never lost) and let delta_span_days carry the caveat.
    if (span !== rowsCovered || span === 1) {
      // ...unless the database would refuse it. Storing the delta whole is the
      // one path that writes a value larger than the per-day rate, so it is the
      // one path that can exceed the CHECK constraint. An unknown day costs one
      // day of reach; a rejected row costs every row in its batch and every day
      // after it.
      if (dv >= MAX_STORABLE_DAILY_VIEWS) {
        clearRunBefore(frozen, i);
        continue;
      }
      out[i].daily_views = dv;
      out[i].delta_span_days = span;
      continue;
    }

    // Even split, remainder on the final (catch-up) day so the sum is exact.
    const base = Math.floor(dv / span);
    const remainder = dv - base * span;
    for (let j = 0; j < span; j++) {
      const idx = i - (span - 1) + j;
      out[idx].daily_views = j === span - 1 ? base + remainder : base;
      out[idx].imputed = true;
      out[idx].delta_span_days = span;
    }
  }

  return out;
}

/** Strand the contiguous frozen run ending just before `i` so no later delta adopts it. */
function clearRunBefore(frozen: boolean[], i: number): void {
  for (let j = i - 1; j >= 0 && frozen[j]; j--) frozen[j] = false;
}

/** Whole days between two YYYY-MM-DD dates; 0 when either is unparseable. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
