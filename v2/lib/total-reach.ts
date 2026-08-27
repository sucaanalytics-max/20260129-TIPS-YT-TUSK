/**
 * Pure helpers for the "total reach" (owned + topic) weekly band.
 *
 * No IO, no state — unit-tested in total-reach.test.ts. The query layer
 * (queries.ts) does the DB reads and delegates the maths to these.
 *
 * Design notes (see the validated plan):
 *  - Weekly cadence is forced by the data: owned/topic are daily flows we
 *    resample up to ISO weeks (Monday-anchored). UGC is handled separately.
 *  - Owned is the certain core (exact YT Data API counts). Topic is an
 *    attributed estimate (daily_views × catalog_share), so it carries the
 *    band width. The K_* multipliers are intentionally conservative and
 *    tunable — adjust as attribution calibration improves.
 */

/** Topic-attribution band multipliers. Owned has zero band width; the
 * uncertainty lives entirely in the attributed topic layer. */
export const K_TOPIC_LOW = 0.7;
export const K_TOPIC_HIGH = 1.15;

/**
 * Monday (UTC, ISO 'YYYY-MM-DD') of the week containing `dateStr`.
 * Uses UTC parsing to avoid timezone drift (matches the convention in
 * queries.ts, which parses dates as `${date}T00:00:00Z`).
 */
export function weekStartMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const sinceMonday = (dow + 6) % 7; // Mon→0, Sun→6
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

export interface DailyPoint {
  date: string;
  value: number | null;
}

export interface WeekBucket {
  weekStart: string; // Monday ISO date
  sum: number; // sum of non-null values in the week
  days: number; // count of days with non-null data (coverage)
}

/**
 * Resample a daily series into Monday-anchored weekly buckets. Nulls are
 * ignored in both the sum and the day-coverage count, so a missing day
 * lowers `days` (graded down later) rather than being treated as a zero.
 * Output is sorted ascending by weekStart.
 */
export function bucketWeekly(series: DailyPoint[]): WeekBucket[] {
  const byWeek = new Map<string, { sum: number; days: number }>();
  for (const p of series) {
    const wk = weekStartMonday(p.date);
    const b = byWeek.get(wk) ?? { sum: 0, days: 0 };
    if (p.value != null) {
      b.sum += p.value;
      b.days += 1;
    }
    byWeek.set(wk, b);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, v]) => ({ weekStart, sum: v.sum, days: v.days }));
}

/**
 * Drop partial weeks at the LEADING and TRAILING edges (fewer than
 * `minDays` days of data) so the first/last bar isn't an artificially low
 * stub. Interior weeks with gaps are kept (they're graded down, not hidden).
 */
export function trimPartialEdges(buckets: WeekBucket[], minDays = 7): WeekBucket[] {
  let start = 0;
  let end = buckets.length;
  while (start < end && buckets[start].days < minDays) start++;
  while (end > start && buckets[end - 1].days < minDays) end--;
  return buckets.slice(start, end);
}

export interface ReachBand {
  low: number;
  mid: number;
  high: number;
}

/**
 * Build a low/mid/high reach band for one company-week. Owned views are
 * the certain core (band width 0); the attributed topic views carry the
 * uncertainty via the conservative K_TOPIC_* multipliers. Guarantees
 * low ≤ mid ≤ high (since K_TOPIC_LOW ≤ 1 ≤ K_TOPIC_HIGH).
 */
export function buildReachBand(opts: { owned: number; topic: number }): ReachBand {
  const { owned, topic } = opts;
  return {
    low: Math.round(owned + topic * K_TOPIC_LOW),
    mid: Math.round(owned + topic),
    high: Math.round(owned + topic * K_TOPIC_HIGH),
  };
}
