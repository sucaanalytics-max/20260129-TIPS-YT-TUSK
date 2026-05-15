/**
 * Shared moving-average helpers used by every daily-views chart in the
 * dashboard (Overview dual-axis, /growth company-views, channel-growth
 * sparklines). Pure — no state, no IO.
 *
 * Convention: trailing right-aligned mean. Skips null values in both
 * numerator and denominator so weekend/holiday gaps don't pull the average
 * down. Window is measured in rows, not calendar days (NSE-trading-day
 * alignment is the dashboard's default).
 */

export type MASmoothing = 'abs' | '7d' | '30d' | '45d';

export const MA_WINDOWS: Record<MASmoothing, number> = {
  abs: 1,
  '7d': 7,
  '30d': 30,
  '45d': 45,
};

export const MA_OPTIONS: { value: MASmoothing; label: string }[] = [
  { value: 'abs', label: 'Abs' },
  { value: '7d', label: '7DMA' },
  { value: '30d', label: '30DMA' },
  { value: '45d', label: '45DMA' },
];

export function rollingMeanArray(values: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const out: Array<number | null> = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let n = 0;
    for (let j = start; j <= i; j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        n += 1;
      }
    }
    out[i] = n > 0 ? sum / n : null;
  }
  return out;
}

/**
 * Same trailing rolling mean, applied to a single numeric field of each row
 * while preserving every other field. Returns a new array of rows (does not
 * mutate input).
 */
export function rollingMeanField<T>(rows: T[], field: keyof T, window: number): T[] {
  if (window <= 1) return rows.slice();
  const values = rows.map((r) => {
    const v = r[field];
    return typeof v === 'number' ? v : v == null ? null : Number(v as unknown as string);
  });
  const smoothed = rollingMeanArray(values, window);
  return rows.map((r, i) => ({ ...r, [field]: smoothed[i] }));
}
