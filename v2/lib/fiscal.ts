/**
 * Indian fiscal-year arithmetic. The FY runs 1 April to 31 March and is
 * labelled by the year it ENDS in, so April 2026 opens FY27 Q1 and March 2026
 * closes FY26 Q4. Getting this backwards silently misfiles every quarter, so it
 * lives in one tested place rather than being recomputed at each call site.
 */

export interface FiscalQuarter {
  fy: number;
  q: 1 | 2 | 3 | 4;
  label: string;
  start: string;
  end: string;
}

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const utc = (d: string): number => Date.parse(d + 'T00:00:00Z');

export function fiscalQuarterOf(date: string): FiscalQuarter {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const fyStartYear = month >= 4 ? year : year - 1;
  const fy = (fyStartYear + 1) % 100;
  const q = (Math.floor(((month - 4 + 12) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
  const startMonth = 4 + (q - 1) * 3;
  const startYear = startMonth > 12 ? fyStartYear + 1 : fyStartYear;
  const sm = ((startMonth - 1) % 12) + 1;
  const start = Date.UTC(startYear, sm - 1, 1);
  const end = Date.UTC(startYear, sm - 1 + 3, 0);
  return {
    fy,
    q,
    label: `FY${String(fy).padStart(2, '0')} Q${q}`,
    start: iso(start),
    end: iso(end),
  };
}

/** Fraction of the quarter elapsed, counting `date` itself. 0 < p <= 1. */
export function quarterProgress(date: string): number {
  const fq = fiscalQuarterOf(date);
  const elapsed = (utc(date) - utc(fq.start)) / DAY + 1;
  const total = (utc(fq.end) - utc(fq.start)) / DAY + 1;
  return elapsed / total;
}

export function previousQuarter(fq: FiscalQuarter): FiscalQuarter {
  return fiscalQuarterOf(iso(utc(fq.start) - DAY));
}

export function sameQuarterLastYear(fq: FiscalQuarter): FiscalQuarter {
  const s = new Date(utc(fq.start));
  return fiscalQuarterOf(iso(Date.UTC(s.getUTCFullYear() - 1, s.getUTCMonth(), 1)));
}
