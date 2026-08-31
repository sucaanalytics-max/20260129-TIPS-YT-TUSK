/**
 * Coverage-aware imputation for the nowcast's reach legs.
 *
 * Pure arithmetic, no I/O — lib/queries.ts is `server-only` and cannot be
 * imported by the test runner, so the logic that decides how much of a quarter
 * was actually MEASURED lives here where it can be tested directly.
 *
 * The problem in one line: a day with no reading is UNKNOWN, not zero, and a
 * day where only some channels reported is PARTIALLY known, not fully known.
 * Summing what exists and dividing by calendar progress silently treats both
 * as measured zeros and reports a number that is low by however much was
 * missing. Per CLAUDE.md a silently wrong number is worse than an absent one,
 * so every estimator here returns `null` when it has nothing to stand on and
 * the caller is expected to fail rather than substitute a zero.
 *
 * Two estimators, because the two legs expose different granularity:
 *
 *   imputePerChannel   — owned channels, where we hold the per-channel daily
 *                        rows. Each channel is imputed at ITS OWN observed
 *                        mean, so losing one large channel for a day does not
 *                        get papered over with the small channels' average.
 *                        This is the accurate one; use it wherever the
 *                        per-channel rows are available.
 *
 *   imputeByDayCoverage — Topic/OAC reach, which reaches us as an already
 *                        aggregated daily attributed series. Only a per-day
 *                        count of contributing channels survives, so the day
 *                        is scaled by its own channel shortfall. That assumes
 *                        the absent channels are of AVERAGE size — weaker than
 *                        the per-channel treatment, and noted at the call site.
 */

/** One channel's reading for one day. `value === null` = nothing was learned. */
export interface ChannelDayReading {
  channelId: string;
  date: string;
  value: number | null;
  /**
   * Calendar days this single reading actually covers (`delta_span_days`).
   *
   * This is NOT always 1, and assuming it was is a real over-count. Migration
   * 0026 repairs a frozen run two ways: where it can it spreads the catch-up
   * evenly over the days, but where rows are missing for part of the span it
   * deliberately KEEPS THE VALUE WHOLE on the unfreeze day and records the span
   * here, so the total is never lost. Such a row holds several days of views
   * while looking like one observed day.
   *
   * Measured on production for Tips owned channels over FY27 Q2: 809 non-null
   * rows covering 899 calendar channel-days. Counting rows instead of span
   * therefore imputes a shortfall that is not there and inflates reach ~11%.
   *
   * Null/undefined means "not computable" and is treated as 1.
   */
  spanDays?: number | null;
  /**
   * True when `daily_views` was derived by spreading a multi-day catch-up
   * rather than measured as a one-day delta. 0026's own column comment: "never
   * present it as measured." It still counts as exposure — the views are real
   * — but it must not be reported as an observed day.
   */
  imputed?: boolean;
}

export interface PerChannelCoverage {
  /** Window total, every channel imputed to the full elapsed window. */
  views: number;
  /**
   * Days on which every channel that reported at all in the window reported a
   * value that was MEASURED. A day carried entirely by spread catch-up values
   * is not an observed day, however complete it looks.
   */
  observedDays: number;
  /** Days that were complete only because a spread catch-up value filled them. */
  imputedDays: number;
  elapsedDays: number;
  /** Channels asked for. */
  channelsTracked: number;
  /** Channels that produced no usable reading at all — imputed as nothing. */
  channelsWithNoReading: number;
}

/**
 * Impute each channel's missing days at that channel's own observed daily mean,
 * then sum. Where a channel reported on every elapsed day this is exactly its
 * measured total; the imputation only ever fills days we did not see.
 *
 * Returns null when nothing at all was measured, so the caller can refuse to
 * report zero reach as a measurement.
 */
export function imputePerChannel(opts: {
  readings: ChannelDayReading[];
  /** The channels expected to report. Readings outside this set are ignored. */
  channelIds: string[];
  elapsedDays: number;
}): PerChannelCoverage | null {
  const { readings, channelIds, elapsedDays } = opts;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return null;
  if (channelIds.length === 0) return null;

  const tracked = new Set(channelIds);
  const sumByChannel = new Map<string, number>();
  // Sets, not counters: a duplicated row must not count as a second day.
  const daysByChannel = new Map<string, Set<string>>();
  // Exposure in CALENDAR days, which is what the views were earned over.
  const exposureByChannel = new Map<string, number>();
  const reportingByDate = new Map<string, Set<string>>();
  const measuredByDate = new Map<string, Set<string>>();

  for (const r of readings) {
    if (!tracked.has(r.channelId)) continue;
    if (r.value == null || !Number.isFinite(r.value)) continue;
    const seen = daysByChannel.get(r.channelId) ?? new Set<string>();
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    daysByChannel.set(r.channelId, seen);
    sumByChannel.set(r.channelId, (sumByChannel.get(r.channelId) ?? 0) + r.value);

    // A span of 0, a negative, or a non-finite is meaningless — a reading
    // covers at least the day it sits on.
    const span =
      typeof r.spanDays === 'number' && Number.isFinite(r.spanDays) && r.spanDays >= 1
        ? Math.floor(r.spanDays)
        : 1;
    exposureByChannel.set(r.channelId, (exposureByChannel.get(r.channelId) ?? 0) + span);

    const onDate = reportingByDate.get(r.date) ?? new Set<string>();
    onDate.add(r.channelId);
    reportingByDate.set(r.date, onDate);
    if (!r.imputed) {
      const m = measuredByDate.get(r.date) ?? new Set<string>();
      m.add(r.channelId);
      measuredByDate.set(r.date, m);
    }
  }

  const reporting = [...daysByChannel.keys()];
  if (reporting.length === 0) return null;

  let views = 0;
  for (const id of reporting) {
    /*
     * Scale by the days NOT covered, where covered is measured in calendar days
     * (span), not in rows. Clamped to the window: a catch-up whose span reaches
     * back past the window start already carries pre-window views in its value,
     * so letting exposure exceed elapsedDays would scale the total DOWN below
     * what was actually read. Clamping makes that case a no-op instead.
     */
    const exposure = Math.min(exposureByChannel.get(id) ?? 0, elapsedDays);
    if (exposure <= 0) continue;
    views += (sumByChannel.get(id) ?? 0) * (elapsedDays / exposure);
  }

  /*
   * "Fully observed" is measured against the channels that reported at all in
   * the window, not against the roster: a channel dead for the whole quarter
   * would otherwise make every single day read as partial and understate how
   * much we actually saw. Its absence is reported separately.
   */
  let observedDays = 0;
  let imputedDays = 0;
  for (const [date, onDate] of reportingByDate) {
    if (onDate.size < reporting.length) continue;
    // Complete on paper. Only call it observed if every contribution was
    // measured rather than spread from a catch-up.
    if ((measuredByDate.get(date)?.size ?? 0) >= reporting.length) observedDays += 1;
    else imputedDays += 1;
  }

  return {
    // A fractional view does not exist, and this is written to the DB as jsonb.
    views: Math.round(views),
    observedDays,
    imputedDays,
    elapsedDays,
    channelsTracked: tracked.size,
    channelsWithNoReading: tracked.size - reporting.length,
  };
}

/** One already-aggregated day. `value === null` = nothing was learned. */
export interface DayReading {
  date: string;
  value: number | null;
  /**
   * How many channels actually CONTRIBUTED a value that day — not how many
   * rows exist. A frozen channel still has a row and Postgres `sum()` skips
   * its NULL, so a day can carry a non-NULL PARTIAL total.
   */
  channelsReporting: number;
  /**
   * Channel-days of exposure this day's value actually represents: the sum of
   * `delta_span_days` across the channels that contributed. Defaults to
   * `channelsReporting` when unknown.
   *
   * Same trap as the owned leg. A topic channel's catch-up lump lands wholly on
   * its unfreeze date while its frozen dates drop out of `channelsReporting`,
   * so the day looks thin and gets scaled UP even though its value already
   * carries the missing days. Counting exposure instead of contributors makes
   * the two cancel.
   */
  channelDaysCovered?: number | null;
}

export interface DayCoverage {
  /** Window total, scaled up for both partial days and missing days. */
  views: number;
  /** Days carrying the full expected channel count. */
  observedDays: number;
  /** Days carrying some, but not all, of the expected channels. */
  partialDays: number;
  elapsedDays: number;
  /** Channel count a complete day carries, derived from the data. */
  expectedChannels: number;
  /** Observed exposure in whole-day equivalents. */
  coverageDays: number;
}

/**
 * Scale an aggregated daily series up to the full elapsed window, counting a
 * partially-reported day as the fraction of a day it actually covers.
 *
 * The expected channel count is derived from the data (the largest count seen
 * in the window), never hardcoded, so it follows the roster. Caveat worth
 * knowing: a channel that joins mid-window raises the expected count and makes
 * the days before it existed read as partial. That inflates rather than
 * deflates, so it is not the silent-understatement failure this guards against,
 * but it is a real distortion when the roster changes inside a window.
 *
 * Returns null when no day carried any reading at all. A window that genuinely
 * measured zero views across reporting channels returns views 0 — that is a
 * measurement, and is deliberately distinguished from having measured nothing.
 */
export function imputeByDayCoverage(opts: {
  days: DayReading[];
  elapsedDays: number;
}): DayCoverage | null {
  const { days, elapsedDays } = opts;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return null;

  const usable = days.filter(
    (d) => d.value != null && Number.isFinite(d.value) && d.channelsReporting > 0,
  );
  if (usable.length === 0) return null;

  const expectedChannels = usable.reduce((m, d) => Math.max(m, d.channelsReporting), 0);
  if (expectedChannels <= 0) return null;

  let total = 0;
  let coverageDays = 0;
  let observedDays = 0;
  let partialDays = 0;
  const seen = new Set<string>();
  for (const d of usable) {
    if (seen.has(d.date)) continue;
    seen.add(d.date);
    total += d.value as number;
    const covered =
      typeof d.channelDaysCovered === 'number' &&
      Number.isFinite(d.channelDaysCovered) &&
      d.channelDaysCovered > 0
        ? d.channelDaysCovered
        : d.channelsReporting;
    // Cap at a whole day: a catch-up can make one date represent more than one
    // day of exposure, but it cannot make the window longer than it is.
    coverageDays += Math.min(covered, expectedChannels) / expectedChannels;
    if (d.channelsReporting >= expectedChannels) observedDays += 1;
    else partialDays += 1;
  }
  if (coverageDays <= 0) return null;

  return {
    views: Math.round(total * (elapsedDays / coverageDays)),
    observedDays,
    partialDays,
    elapsedDays,
    expectedChannels,
    coverageDays,
  };
}
