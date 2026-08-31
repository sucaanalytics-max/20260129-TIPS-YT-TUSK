/**
 * Quarter / year bucketing and period-over-period comparison.
 *
 * Two things make a percentage here dishonest, and both are guarded.
 *
 * 1. The MEASUREMENT REGIME BREAK. v_company_daily is a union of two eras:
 *
 *      2023-01-04 .. 2026-02-15  one synthetic "Pre-2026 Aggregate" row per day
 *                                (1.0 channels/day, no per-channel breakdown)
 *      2026-02-16 .. now         real per-channel data (15 TIPS / 23 SAREGAMA)
 *
 *    Totals either side are broadly comparable, but they are not the same
 *    measurement, and nothing before the break can be sliced by channel at all.
 *
 * 2. PERIOD COMPLETENESS. The newest bucket is almost always in flight: on
 *    2026-08-31 the 2026-Q3 bucket holds 61 of 92 calendar days. Comparing that
 *    part-period total against a whole prior quarter renders a perfectly flat
 *    business as a one-third collapse, and does so most violently on the first
 *    day of a quarter. The same applies at the leading edge, where the first
 *    bucket in the data window is a stub. lib/total-reach.ts solves this by
 *    dropping partial edges outright; a comparison table cannot drop the row the
 *    reader came to see, so instead the part-period keeps its (true) total,
 *    withholds the (meaningless) percentage, and says how much of the period it
 *    holds. A like-for-like figure against the SAME elapsed slice of the prior
 *    period is offered alongside — explicitly labelled, never as a silent
 *    substitute for the whole-period change.
 *
 * Every bucket and every comparison therefore carries its regime and its
 * completeness, and says so rather than leaving the reader to find out.
 *
 * Buckets are CALENDAR quarters and CALENDAR years. That is deliberate: this
 * page makes no filing claim, so it does not use the Apr-Mar fiscal year that
 * lib/fiscal.ts implements for the nowcast. The labels say so plainly.
 */

/** First day of real per-channel data. Verified against the database, not assumed. */
export const REGIME_BREAK = '2026-02-16';

export type Granularity = 'quarter' | 'year';

export interface DatedValue {
  date: string;
  value: number | null;
}

export type Regime = 'legacy' | 'current' | 'mixed';

export interface PeriodBucket {
  key: string;
  total: number;
  days: number;
  /** Days present in the period whose value was unknown. */
  missing: number;
  /** Calendar days the period contains: 92 for 2026-Q3, 365 for 2026. */
  expectedDays: number;
  /** Calendar days from the start of the period up to and including `to`. */
  elapsedDays: number;
  /** True when the period has a row (valued or null) for every calendar day. */
  complete: boolean;
  from: string;
  to: string;
  regime: Regime;
  straddlesRegimeBreak: boolean;
}

export interface PeriodComparison extends PeriodBucket {
  priorKey: string | null;
  priorTotal: number | null;
  /**
   * Whole-period change against the prior period. Null when the pairing is not
   * whole-against-whole — a part-period percentage is a calendar artefact, and
   * an absent number beats a confidently wrong one.
   */
  changePct: number | null;
  /**
   * Like-for-like fallback for a pairing that is not whole-against-whole: both
   * periods restricted to the calendar days (by day-of-period index) on which
   * BOTH carry a reading. Null when there is nothing to salvage, or when the
   * regime break already rules the comparison out.
   */
  sharedDays: number | null;
  /** This period's total over those shared days. */
  partialTotal: number | null;
  /** The prior period's total over those shared days. */
  priorPartialTotal: number | null;
  /** Change between the two shared-day totals. Labelled as like-for-like in the UI. */
  partialChangePct: number | null;
  /** False when this period and its prior were not measured the same way. */
  comparable: boolean;
  caveat: string | null;
}

const DAY = 86_400_000;
const utc = (d: string): number => Date.parse(d + 'T00:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function periodKey(date: string, g: Granularity): string {
  const year = date.slice(0, 4);
  if (g === 'year') return year;
  const month = Number(date.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/**
 * Calendar bounds of a bucket key ('2026' or '2026-Q3'), derived from the key
 * alone so completeness costs no extra query. Leap years fall out of Date.UTC.
 */
export function periodBounds(key: string): { start: string; end: string; expectedDays: number } {
  const year = Number(key.slice(0, 4));
  const q = key.length > 4 ? Number(key.slice(6)) : null;
  const startMonth = q ? (q - 1) * 3 : 0;
  const endMonthExclusive = q ? startMonth + 3 : 12;
  const start = Date.UTC(year, startMonth, 1);
  const end = Date.UTC(year, endMonthExclusive, 0);
  return { start: iso(start), end: iso(end), expectedDays: (end - start) / DAY + 1 };
}

/** 1-based index of `date` within its period: 2026-07-01 in 2026-Q3 is 1. */
export function dayIndexInPeriod(date: string, g: Granularity): number {
  return (utc(date) - utc(periodBounds(periodKey(date, g)).start)) / DAY + 1;
}

const regimeOf = (date: string): Exclude<Regime, 'mixed'> =>
  date < REGIME_BREAK ? 'legacy' : 'current';

/**
 * Calendar days of the period that actually contributed a VALUE.
 *
 * Deliberately not `days + missing`. A frozen reading leaves a row with a null
 * value (see 0026_view_delta_repair), and counting the row made a period with
 * an eight-day freeze "complete" while `total` summed only the 84 days that
 * carried a number. A perfectly flat business then published a red -7.7% with
 * no caveat at all, because the calendar was whole even though the total was
 * not. The value is what the percentage is computed from, so the value is what
 * completeness has to be measured on.
 *
 * This is not a stricter gate for its own sake: a period that falls short here
 * drops into the like-for-like path below, which compares the two periods over
 * the days they BOTH measured. That is a better answer than the whole-period
 * figure, not a withheld one.
 */
const covered = (b: PeriodBucket): number => b.days;

export function bucketByPeriod(rows: DatedValue[], g: Granularity): PeriodBucket[] {
  const acc = new Map<string, PeriodBucket>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = periodKey(r.date, g);
    const cur =
      acc.get(key) ??
      ({
        key,
        total: 0,
        days: 0,
        missing: 0,
        expectedDays: periodBounds(key).expectedDays,
        elapsedDays: 0,
        complete: false,
        from: r.date,
        to: r.date,
        regime: regimeOf(r.date),
        straddlesRegimeBreak: false,
      } as PeriodBucket);

    if (r.value == null) {
      cur.missing += 1;
    } else {
      cur.total += r.value;
      cur.days += 1;
    }
    if (r.date < cur.from) cur.from = r.date;
    if (r.date > cur.to) cur.to = r.date;

    const thisRegime = regimeOf(r.date);
    if (cur.regime !== thisRegime) {
      cur.regime = 'mixed';
      cur.straddlesRegimeBreak = true;
    }
    acc.set(key, cur);
  }
  for (const b of acc.values()) {
    b.elapsedDays = dayIndexInPeriod(b.to, g);
    b.complete = covered(b) >= b.expectedDays;
  }
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const REGIME_CAVEAT =
  `Spans the ${REGIME_BREAK} measurement change: before it the series is a single ` +
  `legacy aggregate, after it real per-channel data. Directional only.`;

const partOf = (b: PeriodBucket): string =>
  `${b.key} holds ${covered(b)} of ${b.expectedDays} days`;

export function comparePeriods(rows: DatedValue[], g: Granularity): PeriodComparison[] {
  const buckets = bucketByPeriod(rows, g);

  // Valued rows indexed by day-of-period, so two periods can be intersected on
  // the calendar days both actually measured.
  const byKey = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (r.value == null) continue;
    const key = periodKey(r.date, g);
    const day = dayIndexInPeriod(r.date, g);
    const m = byKey.get(key);
    if (m) m.set(day, (m.get(day) ?? 0) + r.value);
    else byKey.set(key, new Map([[day, r.value]]));
  }

  return buckets.map((b, i) => {
    const prior = i > 0 ? buckets[i - 1] : null;

    const sameRegime = !prior || (prior.regime === b.regime && !b.straddlesRegimeBreak);
    const wholeAgainstWhole = b.complete && (!prior || prior.complete);
    const comparable = sameRegime && wholeAgainstWhole;

    // The whole-period percentage is published only when both sides are whole
    // periods. A part-period figure is a calendar artefact, not a business move.
    const changePct =
      prior && prior.total !== 0 && wholeAgainstWhole
        ? ((b.total - prior.total) / prior.total) * 100
        : null;

    // Like-for-like: both periods restricted to the days both measured. Offered
    // only where completeness is the sole obstacle, so it never launders a
    // comparison across the regime break, and only where it says something the
    // whole-period figure does not.
    let sharedDays: number | null = null;
    let partialTotal: number | null = null;
    let priorPartialTotal: number | null = null;
    let partialChangePct: number | null = null;
    if (prior && sameRegime && !wholeAgainstWhole) {
      const mine = byKey.get(b.key);
      const theirs = byKey.get(prior.key);
      if (mine && theirs) {
        let n = 0;
        let a = 0;
        let p = 0;
        for (const [day, v] of mine) {
          const q = theirs.get(day);
          if (q == null) continue;
          n += 1;
          a += v;
          p += q;
        }
        if (n > 0) {
          sharedDays = n;
          partialTotal = a;
          priorPartialTotal = p;
          partialChangePct = p === 0 ? null : ((a - p) / p) * 100;
        }
      }
    }

    const notes: string[] = [];
    if (!sameRegime) notes.push(REGIME_CAVEAT);
    if (!wholeAgainstWhole && prior) {
      const sides = [!b.complete ? partOf(b) : null, !prior.complete ? partOf(prior) : null]
        .filter(Boolean)
        .join('; ');
      notes.push(
        `${sides}. Part-period against whole-period, so the period-over-period ` +
          `percentage is withheld rather than shown as a fall that is really a calendar artefact.`,
      );
      if (sharedDays != null && partialChangePct != null) {
        notes.push(
          `Like-for-like on the ${sharedDays} day${sharedDays === 1 ? '' : 's'} both periods ` +
            `measured: ${partialChangePct >= 0 ? '+' : ''}${partialChangePct.toFixed(1)}%.`,
        );
      }
    } else if (!b.complete && !prior) {
      notes.push(`${partOf(b)}. Still in flight.`);
    }

    return {
      ...b,
      priorKey: prior?.key ?? null,
      priorTotal: prior?.total ?? null,
      changePct,
      sharedDays,
      partialTotal,
      priorPartialTotal,
      partialChangePct,
      comparable,
      caveat: notes.length > 0 ? notes.join(' ') : null,
    };
  });
}
