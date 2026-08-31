/**
 * Scoring the nowcast against what actually printed.
 *
 * This is the part that makes the product honest: accuracy is earned by a track
 * record rather than declared by a confidence badge. An empty history reports
 * as UNPROVEN — never as a perfect score — because a model that has never been
 * checked is the least trustworthy state, not the most.
 */

import type { NowcastBand } from './nowcast';

export interface ScoredQuarter {
  fiscalLabel: string;
  estimate: NowcastBand;
  actual: number;
  absError: number;
  /** Null when the actual is zero and a percentage would be undefined. */
  pctError: number | null;
  withinBand: boolean;
}

export interface TrackRecord {
  n: number;
  /** Share of quarters where the actual fell inside the band. Null when n = 0. */
  hitRate: number | null;
  medianAbsPctError: number | null;
  worst: ScoredQuarter | null;
}

export function scoreEstimate(
  estimate: NowcastBand,
  actual: number,
): { absError: number; pctError: number | null; withinBand: boolean } {
  const absError = Math.abs(actual - estimate.mid);
  return {
    absError,
    pctError: actual === 0 ? null : (absError / actual) * 100,
    withinBand: actual >= estimate.low && actual <= estimate.high,
  };
}

export function summariseTrackRecord(scored: ScoredQuarter[]): TrackRecord {
  if (scored.length === 0) {
    return { n: 0, hitRate: null, medianAbsPctError: null, worst: null };
  }
  const hits = scored.filter((s) => s.withinBand).length;

  const pcts = scored
    .map((s) => s.pctError)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  const median =
    pcts.length === 0
      ? null
      : pcts.length % 2 === 1
        ? pcts[(pcts.length - 1) / 2]
        : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2;

  const worst = scored.reduce((a, b) => (b.absError > a.absError ? b : a));

  return {
    n: scored.length,
    hitRate: hits / scored.length,
    medianAbsPctError: median,
    worst,
  };
}
