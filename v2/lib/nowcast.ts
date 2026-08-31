/**
 * Quarter revenue nowcast from measured reach and owned assumptions.
 *
 * Deliberately simple and legible: quarter-to-date views are extrapolated to a
 * full quarter, priced at a CPM band, then grossed up for revenue the YouTube
 * data cannot see. Every assumption is an explicit input rather than a buried
 * constant — the previous royalty model was 4.7x a company's entire revenue
 * because its heroic assumption lived in a file nobody looked at.
 *
 * The output is a BAND, never a point. A single number would imply precision
 * this model does not have.
 */

export interface NowcastDrivers {
  /** Quarter-to-date views on owned channels, imputed to full day coverage. */
  ownedViews: number;
  /** Quarter-to-date views attributed via Topic / OAC channels. */
  topicViews: number;
  /** Quarter-to-date UGC reach. A sampled lower bound. */
  ugcViews: number;
  /**
   * Day coverage behind the figures above. Carried for auditability only —
   * computeNowcast ignores these, because getNowcastDrivers has already
   * imputed the gap. They are stored with the estimate so a later reader can
   * see how much of the quarter was actually observed.
   */
  observedDays?: number;
  elapsedDays?: number;
}

export interface NowcastAssumptions {
  /** Rupees per 1,000 views. */
  cpmLow: number;
  cpmMid: number;
  cpmHigh: number;
  /** Multiplier for revenue not visible on YouTube. 1 = YouTube is everything. */
  nonYouTubeUplift: number;
  includeUgc: boolean;
}

export interface NowcastBand {
  low: number;
  mid: number;
  high: number;
}

export interface DriverContribution {
  driver: 'owned' | 'topic' | 'ugc';
  mid: number;
  pctOfMid: number;
}

export interface NowcastResult {
  band: NowcastBand;
  contributions: DriverContribution[];
  projectedViews: number;
  quarterProgress: number;
}

/** Starting point only. These are meant to be overridden and argued about. */
export const DEFAULT_ASSUMPTIONS: NowcastAssumptions = {
  cpmLow: 94,
  cpmMid: 118,
  cpmHigh: 142,
  nonYouTubeUplift: 1.4,
  // Off by default: UGC reach is cumulative, not a quarterly flow (see
  // getNowcastDrivers). Turn on only once it is measured per period.
  includeUgc: false,
};

export function computeNowcast(opts: {
  drivers: NowcastDrivers;
  assumptions: NowcastAssumptions;
  quarterProgress: number;
}): NowcastResult {
  const { drivers, assumptions, quarterProgress } = opts;
  const p = quarterProgress;

  const project = (v: number): number => (p > 0 ? v / p : 0);
  const owned = project(drivers.ownedViews);
  const topic = project(drivers.topicViews);
  const ugc = assumptions.includeUgc ? project(drivers.ugcViews) : 0;
  const projectedViews = owned + topic + ugc;

  const price = (views: number, cpm: number): number =>
    (views / 1000) * cpm * assumptions.nonYouTubeUplift;

  const band: NowcastBand = {
    low: price(projectedViews, assumptions.cpmLow),
    mid: price(projectedViews, assumptions.cpmMid),
    high: price(projectedViews, assumptions.cpmHigh),
  };

  const parts: Array<[DriverContribution['driver'], number]> = [
    ['owned', owned],
    ['topic', topic],
    ['ugc', ugc],
  ];
  const contributions: DriverContribution[] = parts.map(([driver, views]) => {
    const mid = price(views, assumptions.cpmMid);
    return { driver, mid, pctOfMid: band.mid > 0 ? (mid / band.mid) * 100 : 0 };
  });

  return { band, contributions, projectedViews, quarterProgress: p };
}
