/**
 * Quarter / year bucketing and period-over-period comparison.
 *
 * The load-bearing detail is the MEASUREMENT REGIME BREAK. v_company_daily is a
 * union of two eras:
 *
 *   2023-01-04 .. 2026-02-15  one synthetic "Pre-2026 Aggregate" row per day
 *                             (1.0 channels/day, no per-channel breakdown)
 *   2026-02-16 .. now         real per-channel data (15 TIPS / 23 SAREGAMA)
 *
 * Totals either side are broadly comparable, but they are not the same
 * measurement, and nothing before the break can be sliced by channel at all.
 * A year-over-year figure that silently spans it is a like-for-unlike
 * comparison, so every bucket and every comparison carries its regime and
 * says so rather than leaving the reader to find out.
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
  from: string;
  to: string;
  regime: Regime;
  straddlesRegimeBreak: boolean;
}

export interface PeriodComparison extends PeriodBucket {
  priorKey: string | null;
  priorTotal: number | null;
  changePct: number | null;
  /** False when this period and its prior were not measured the same way. */
  comparable: boolean;
  caveat: string | null;
}

export function periodKey(date: string, g: Granularity): string {
  const year = date.slice(0, 4);
  if (g === 'year') return year;
  const month = Number(date.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

const regimeOf = (date: string): Exclude<Regime, 'mixed'> =>
  date < REGIME_BREAK ? 'legacy' : 'current';

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
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function comparePeriods(rows: DatedValue[], g: Granularity): PeriodComparison[] {
  const buckets = bucketByPeriod(rows, g);
  return buckets.map((b, i) => {
    const prior = i > 0 ? buckets[i - 1] : null;
    const changePct =
      prior && prior.total !== 0 ? ((b.total - prior.total) / prior.total) * 100 : null;

    const comparable = !prior || (prior.regime === b.regime && !b.straddlesRegimeBreak);
    return {
      ...b,
      priorKey: prior?.key ?? null,
      priorTotal: prior?.total ?? null,
      changePct,
      comparable,
      caveat: comparable
        ? null
        : `Spans the ${REGIME_BREAK} measurement change: before it the series is a single legacy aggregate, after it real per-channel data. Directional only.`,
    };
  });
}
