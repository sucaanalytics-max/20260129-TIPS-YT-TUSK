/**
 * Date range presets used by every page that supports filtering.
 *
 * All dates are returned as YYYY-MM-DD strings in UTC. The `to` boundary is
 * inclusive (i.e. data for that date is included).
 *
 * Indian financial year semantics: FY runs Apr 1 → Mar 31 of the next year.
 * Tusk-internal convention follows Indian-equity-research norm, e.g. FY26 =
 * Apr 1 2025 → Mar 31 2026.
 *
 * Calendar months/quarters are preferred over trailing-N-day windows for
 * "last month" / "last quarter" because that's how equity research talks
 * (a quarterly result is for a calendar quarter, not a rolling 90 days).
 */

export type RangePreset =
  | 'last_30d'
  | 'last_month'
  | 'last_quarter'
  | 'current_fy'
  | 'last_fy'
  | 'custom';

export interface DateRange {
  from: string;       // YYYY-MM-DD, inclusive
  to: string;         // YYYY-MM-DD, inclusive
  label: string;      // human-readable description for headers/tooltips
  preset: RangePreset;
}

const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10);

function utc(year: number, monthIdx: number, day: number): Date {
  return new Date(Date.UTC(year, monthIdx, day));
}

/** Indian financial year start year for a given date (Apr-anchored). */
function fyStartYear(d: Date): number {
  // Months are 0-indexed; April = 3. Before April = previous FY.
  return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Convert an FY start year into ("FY26") label for display. */
function fyLabel(startYear: number): string {
  return `FY${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Resolve a preset (with optional custom dates) into a concrete range.
 * `today` is parameterised so the function is testable and deterministic.
 */
export function resolveRange(
  preset: RangePreset,
  opts: { customFrom?: string; customTo?: string; today?: Date } = {},
): DateRange {
  const today = opts.today ?? new Date();
  const todayUTC = utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  switch (preset) {
    case 'last_30d': {
      const from = new Date(todayUTC.getTime() - 30 * 86_400_000);
      return {
        from: yyyymmdd(from),
        to: yyyymmdd(todayUTC),
        label: 'Last 30 days',
        preset,
      };
    }
    case 'last_month': {
      // Previous calendar month.
      const monthStartThis = utc(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1);
      const lastMonthEnd = new Date(monthStartThis.getTime() - 86_400_000);
      const lastMonthStart = utc(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1);
      return {
        from: yyyymmdd(lastMonthStart),
        to: yyyymmdd(lastMonthEnd),
        label: lastMonthStart.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        preset,
      };
    }
    case 'last_quarter': {
      // Previous calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec).
      const qIdx = Math.floor(todayUTC.getUTCMonth() / 3);
      const lastQuarterStartIdx = qIdx === 0 ? 9 : (qIdx - 1) * 3;
      const lastQuarterStartYear = qIdx === 0 ? todayUTC.getUTCFullYear() - 1 : todayUTC.getUTCFullYear();
      const start = utc(lastQuarterStartYear, lastQuarterStartIdx, 1);
      const end = new Date(utc(lastQuarterStartYear, lastQuarterStartIdx + 3, 1).getTime() - 86_400_000);
      const q = Math.floor(lastQuarterStartIdx / 3) + 1;
      return {
        from: yyyymmdd(start),
        to: yyyymmdd(end),
        label: `Q${q} CY${String(lastQuarterStartYear).slice(-2)}`,
        preset,
      };
    }
    case 'current_fy': {
      const fyStart = fyStartYear(todayUTC);
      return {
        from: yyyymmdd(utc(fyStart, 3, 1)),
        to: yyyymmdd(todayUTC),
        label: `${fyLabel(fyStart)} (YTD)`,
        preset,
      };
    }
    case 'last_fy': {
      const fyStart = fyStartYear(todayUTC) - 1;
      return {
        from: yyyymmdd(utc(fyStart, 3, 1)),
        to: yyyymmdd(utc(fyStart + 1, 2, 31)),
        label: fyLabel(fyStart),
        preset,
      };
    }
    case 'custom': {
      const from = opts.customFrom ?? yyyymmdd(new Date(todayUTC.getTime() - 180 * 86_400_000));
      const to = opts.customTo ?? yyyymmdd(todayUTC);
      return { from, to, label: `${from} → ${to}`, preset };
    }
  }
}

export const PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'last_30d',     label: 'Last 30 days' },
  { value: 'last_month',   label: 'Last month' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'current_fy',   label: 'Current FY' },
  { value: 'last_fy',      label: 'Last FY' },
  { value: 'custom',       label: 'Custom' },
];

export const DEFAULT_PRESET: RangePreset = 'last_30d';

/**
 * Reads a URLSearchParams-like object and returns the resolved range.
 * Used by every page that respects the global filter.
 */
export function rangeFromSearchParams(
  params: { range?: string; from?: string; to?: string } | undefined,
): DateRange {
  const presetCandidate = params?.range as RangePreset | undefined;
  const validPresets: RangePreset[] = ['last_30d', 'last_month', 'last_quarter', 'current_fy', 'last_fy', 'custom'];
  const preset: RangePreset = presetCandidate && validPresets.includes(presetCandidate)
    ? presetCandidate
    : DEFAULT_PRESET;
  return resolveRange(preset, { customFrom: params?.from, customTo: params?.to });
}
