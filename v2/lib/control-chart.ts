/**
 * Shewhart control-chart primitives.
 *
 * A control chart asks a narrower question than a trend line: is this process
 * behaving the way it usually behaves, or did something change? Limits are the
 * mean ±1σ and ±2σ over the window, and a point outside ±2σ is a candidate
 * special cause rather than ordinary variation.
 *
 * Two honesty rules are baked in:
 *   - a null observation is UNKNOWN, never zero. Averaging an unknown as zero
 *     invents a dip that never happened (see lib/view-delta.ts for why nulls
 *     exist at all — YouTube serves stale cumulative counts).
 *   - one-sided breaches are reported. Shewhart limits assume roughly normal,
 *     independent observations; a process that only ever breaches upward is
 *     skewed, and its limits are indicative rather than valid. Callers are
 *     expected to say so rather than quietly drawing them.
 */

export interface ControlPoint {
  date: string;
  value: number | null;
}

export interface ControlLimits {
  mean: number;
  sd: number;
  ucl1: number;
  ucl2: number;
  lcl1: number;
  lcl2: number;
  n: number;
}

export interface Violation {
  date: string;
  value: number;
  sigma: number;
}

export interface ControlChart {
  points: ControlPoint[];
  limits: ControlLimits | null;
  movingAverages: Record<number, Array<number | null>>;
  violations: Violation[];
  /** Breach balance. `oneSided` means the limits should be labelled indicative. */
  skew: { above: number; below: number; oneSided: boolean };
}

/** Trailing mean over `window` observations. Nulls shorten the window rather than counting as zero. */
export function movingAverage(values: Array<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < window) {
      out.push(null);
      continue;
    }
    const slice = values.slice(i + 1 - window, i + 1).filter((v): v is number => v != null);
    out.push(slice.length === 0 ? null : slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

/** Mean, sample σ (n−1) and the ±1σ / ±2σ limits. Null when there is nothing to describe. */
export function controlLimits(values: Array<number | null>): ControlLimits | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (xs.length - 1));
  return {
    mean,
    sd,
    ucl1: mean + sd,
    ucl2: mean + 2 * sd,
    lcl1: mean - sd,
    lcl2: mean - 2 * sd,
    n: xs.length,
  };
}

export function buildControlChart(points: ControlPoint[], windows: number[]): ControlChart {
  const values = points.map((p) => p.value);
  const limits = controlLimits(values);

  const movingAverages: Record<number, Array<number | null>> = {};
  for (const w of windows) movingAverages[w] = movingAverage(values, w);

  const violations: Violation[] = [];
  let above = 0;
  let below = 0;
  if (limits && limits.sd > 0) {
    for (const p of points) {
      if (p.value == null) continue;
      const sigma = (p.value - limits.mean) / limits.sd;
      if (sigma > 2) {
        above++;
        violations.push({ date: p.date, value: p.value, sigma });
      } else if (sigma < -2) {
        below++;
        violations.push({ date: p.date, value: p.value, sigma });
      }
    }
  }

  return {
    points,
    limits,
    movingAverages,
    violations,
    // Both-sided-but-empty is not skew; it is simply an in-control process.
    skew: { above, below, oneSided: above + below > 0 && (above === 0 || below === 0) },
  };
}
