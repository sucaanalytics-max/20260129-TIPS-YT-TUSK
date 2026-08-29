# Nowcast Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data and model spine for a revenue nowcast that is scored against reported results — reported financials, fiscal arithmetic, the nowcast model, the scoring loop, and a daily job that appends today's estimate. No UI.

**Architecture:** Pure, unit-tested libraries hold all logic (`lib/fiscal.ts`, `lib/nowcast.ts`, `lib/scoring.ts`, `lib/financials.ts`). Two new tables store actuals and the estimate time series. A cron route composes them. This mirrors the existing split: `lib/*.ts` is pure and testable, `lib/queries.ts` is `server-only` I/O, `app/api/cron/*` orchestrates.

**Tech Stack:** TypeScript, Next 16 (App Router, cacheComponents), Supabase Postgres, `node:test` via `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-29-fundamentals-nowcast-design.md`

## Global Constraints

- All money is stored in **rupees** as `numeric`, never lakhs or crore. Filings report lakhs; convert at the boundary (`× 100_000`).
- Indian fiscal year: **FY runs 1 Apr – 31 Mar**. FY27 Q1 = Apr–Jun 2026. FY label is the year the FY *ends* in.
- Nowcast targets differ per company and are **never comparable at level**: Tips = total revenue from operations (single segment); Saregama = the **Music segment only**.
- Every extracted financial lands with `confirmed_by IS NULL` and is **excluded from scoring** until confirmed.
- Pure libraries import nothing from `lib/queries.ts` (it is `server-only`). Client-safe constants live in their own module.
- Tests run with `npx -y tsx --test lib/<name>.test.ts` using `node:test` + `assert/strict`.
- Migrations are applied with the Supabase MCP `apply_migration`; the file in `v2/db/migrations/` must match what was applied.

---

### Task 1: Fiscal quarter arithmetic

**Files:**
- Create: `v2/lib/fiscal.ts`
- Test: `v2/lib/fiscal.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `FiscalQuarter {fy: number; q: 1|2|3|4; label: string; start: string; end: string}`, `fiscalQuarterOf(date: string): FiscalQuarter`, `quarterProgress(date: string): number`, `previousQuarter(fq: FiscalQuarter): FiscalQuarter`, `sameQuarterLastYear(fq: FiscalQuarter): FiscalQuarter`

- [ ] **Step 1: Write the failing test**

```ts
// v2/lib/fiscal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiscalQuarterOf, quarterProgress, previousQuarter, sameQuarterLastYear } from './fiscal';

test('fiscalQuarterOf: Indian FY starts in April; label is the ending year', () => {
  assert.deepEqual(fiscalQuarterOf('2026-08-29'), {
    fy: 27, q: 2, label: 'FY27 Q2', start: '2026-07-01', end: '2026-09-30',
  });
  assert.deepEqual(fiscalQuarterOf('2026-04-01'), {
    fy: 27, q: 1, label: 'FY27 Q1', start: '2026-04-01', end: '2026-06-30',
  });
});

test('fiscalQuarterOf: Jan-Mar belongs to Q4 of the FY that ends that year', () => {
  assert.deepEqual(fiscalQuarterOf('2026-03-31'), {
    fy: 26, q: 4, label: 'FY26 Q4', start: '2026-01-01', end: '2026-03-31',
  });
  assert.equal(fiscalQuarterOf('2026-01-01').label, 'FY26 Q4');
});

test('quarterProgress: 29 Aug 2026 is 60 of 92 days into FY27 Q2', () => {
  assert.equal(Number(quarterProgress('2026-08-29').toFixed(4)), 0.6522);
});

test('quarterProgress: first and last day of a quarter', () => {
  assert.equal(Number(quarterProgress('2026-07-01').toFixed(4)), Number((1 / 92).toFixed(4)));
  assert.equal(quarterProgress('2026-09-30'), 1);
});

test('previousQuarter: steps back, rolling the FY at Q1', () => {
  assert.equal(previousQuarter(fiscalQuarterOf('2026-08-29')).label, 'FY27 Q1');
  assert.equal(previousQuarter(fiscalQuarterOf('2026-04-15')).label, 'FY26 Q4');
});

test('sameQuarterLastYear: same quarter number, one FY back', () => {
  const q = sameQuarterLastYear(fiscalQuarterOf('2026-08-29'));
  assert.equal(q.label, 'FY26 Q2');
  assert.equal(q.start, '2025-07-01');
  assert.equal(q.end, '2025-09-30');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && npx -y tsx --test lib/fiscal.test.ts`
Expected: FAIL — cannot find module `./fiscal`

- [ ] **Step 3: Write the implementation**

```ts
// v2/lib/fiscal.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && npx -y tsx --test lib/fiscal.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Typecheck and commit**

```bash
cd v2 && npx tsc --noEmit
cd .. && git add v2/lib/fiscal.ts v2/lib/fiscal.test.ts
git commit -m "Fiscal quarter arithmetic for the Indian FY"
```

---

### Task 2: Reported financials table, seeded with verified actuals

**Files:**
- Create: `v2/db/migrations/0027_reported_financials.sql`

**Interfaces:**
- Consumes: `dim_company(company)` for the FK
- Produces: table `fct_reported_financials(company, fiscal_label, line_item, value_inr, source_url, extraction_method, confirmed_by, confirmed_at, notes)`

- [ ] **Step 1: Write the migration**

```sql
-- v2/db/migrations/0027_reported_financials.sql
-- =============================================================================
-- Reported financials — the actuals a nowcast is scored against.
--
-- Stored in RUPEES. Filings report lakhs; conversion happens at the boundary
-- (x 100,000) so nothing downstream has to remember the unit.
--
-- The nowcast targets DIFFERENT line items per company, verified against the
-- Q1 FY27 filings rather than assumed:
--   TIPSMUSIC — single segment, so 'revenue_from_operations' IS the music line.
--   SAREGAMA  — four segments; only 'segment_revenue_music' is comparable.
-- They are never comparable at level: Tips' figure is a whole company,
-- Saregama's is one segment of one. Growth rates compare; absolutes do not.
--
-- confirmed_by IS NULL means a figure was extracted but not yet checked by a
-- human. Such rows MUST be excluded from scoring — a misparsed revenue line
-- would silently poison the entire track record.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_reported_financials (
  company           text NOT NULL REFERENCES dim_company(company),
  fiscal_label      text NOT NULL,              -- 'FY27 Q1' | 'FY26' (full year)
  line_item         text NOT NULL,              -- see CHECK below
  value_inr         numeric NOT NULL,           -- RUPEES, not lakhs
  source_url        text,
  extraction_method text NOT NULL DEFAULT 'manual',  -- 'manual' | 'pdf' | 'api'
  confirmed_by      text,
  confirmed_at      timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, fiscal_label, line_item)
);

ALTER TABLE fct_reported_financials DROP CONSTRAINT IF EXISTS fct_reported_financials_line_chk;
ALTER TABLE fct_reported_financials ADD CONSTRAINT fct_reported_financials_line_chk
  CHECK (line_item IN (
    'revenue_from_operations',
    'segment_revenue_music',
    'segment_revenue_artist_management',
    'segment_revenue_video',
    'segment_revenue_events',
    'segment_profit_music'
  ));

ALTER TABLE fct_reported_financials DROP CONSTRAINT IF EXISTS fct_reported_financials_value_chk;
ALTER TABLE fct_reported_financials ADD CONSTRAINT fct_reported_financials_value_chk
  CHECK (value_inr >= 0 AND value_inr < 1e13);   -- < Rs 10,000 crore sanity ceiling

CREATE INDEX IF NOT EXISTS idx_reported_financials_lookup
  ON fct_reported_financials (company, line_item, fiscal_label);

ALTER TABLE fct_reported_financials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_reported_financials FROM anon, authenticated;

-- --- Seed: figures read directly off the Q1 FY27 filings -------------------
-- Both filings state "INR in Lakhs"; values below are lakhs x 100,000.
-- confirmed_by is set because these were read from the filing by a human in
-- session, not machine-extracted.
INSERT INTO fct_reported_financials
  (company, fiscal_label, line_item, value_inr, source_url, extraction_method, confirmed_by, confirmed_at, notes)
VALUES
  ('TIPSMUSIC','FY27 Q1','revenue_from_operations', 1065122000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2a77e45a-6e19-49f2-a454-ef7296298a3e.pdf',
   'manual','session-2026-08-29', now(), '10,651.22 lakhs. Single segment.'),
  ('TIPSMUSIC','FY26 Q4','revenue_from_operations', 1039330000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2a77e45a-6e19-49f2-a454-ef7296298a3e.pdf',
   'manual','session-2026-08-29', now(), '10,393.30 lakhs, comparative column.'),
  ('TIPSMUSIC','FY26 Q1','revenue_from_operations', 880684000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2a77e45a-6e19-49f2-a454-ef7296298a3e.pdf',
   'manual','session-2026-08-29', now(), '8,806.84 lakhs, prior-year quarter.'),
  ('TIPSMUSIC','FY26','revenue_from_operations', 3755149000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2a77e45a-6e19-49f2-a454-ef7296298a3e.pdf',
   'manual','session-2026-08-29', now(), '37,551.49 lakhs, year ended 31 Mar 2026.'),
  ('SAREGAMA','FY27 Q1','segment_revenue_music', 1846000000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2913f5e5-9f08-4193-b9b5-2c0d0902c71a.pdf',
   'manual','session-2026-08-29', now(), '18,460 lakhs. Music segment only.'),
  ('SAREGAMA','FY26 Q4','segment_revenue_music', 2004300000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2913f5e5-9f08-4193-b9b5-2c0d0902c71a.pdf',
   'manual','session-2026-08-29', now(), '20,043 lakhs, comparative column.'),
  ('SAREGAMA','FY26 Q1','segment_revenue_music', 1432800000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2913f5e5-9f08-4193-b9b5-2c0d0902c71a.pdf',
   'manual','session-2026-08-29', now(), '14,328 lakhs, prior-year quarter.'),
  ('SAREGAMA','FY26','segment_revenue_music', 6835200000,
   'https://www.bseindia.com/xml-data/corpfiling/AttachLive/2913f5e5-9f08-4193-b9b5-2c0d0902c71a.pdf',
   'manual','session-2026-08-29', now(), '68,352 lakhs, year ended 31 Mar 2026. 69.4% of group.')
ON CONFLICT (company, fiscal_label, line_item) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Apply the file's contents with the Supabase MCP `apply_migration` tool against project `bfafqccvzboyfjewzvhk`, name `0027_reported_financials`.

- [ ] **Step 3: Verify what landed**

Run this with `execute_sql`:

```sql
SELECT company, fiscal_label, line_item, (value_inr/1e7)::numeric(10,2) AS crore, confirmed_by IS NOT NULL AS confirmed
  FROM fct_reported_financials ORDER BY company, fiscal_label;
```

Expected: 8 rows, all `confirmed = true`. Tips FY27 Q1 = 106.51 crore; Saregama FY27 Q1 = 184.60 crore.

- [ ] **Step 4: Commit**

```bash
git add v2/db/migrations/0027_reported_financials.sql
git commit -m "0027: reported financials, seeded from the Q1 FY27 filings"
```

---

### Task 3: Financial normalisation helpers

**Files:**
- Create: `v2/lib/financials.ts`
- Test: `v2/lib/financials.test.ts`

**Interfaces:**
- Consumes: `FiscalQuarter` from `./fiscal`
- Produces: `lakhsToRupees(n: number): number`, `rupeesToCrore(n: number): number`, `formatCrore(n: number): string`, `parseFilingAmount(text: string): number | null`, `TARGET_LINE_ITEM: Record<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// v2/lib/financials.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lakhsToRupees, rupeesToCrore, formatCrore, parseFilingAmount, TARGET_LINE_ITEM,
} from './financials';

test('lakhsToRupees: filings report lakhs; we store rupees', () => {
  assert.equal(lakhsToRupees(10651.22), 1065122000);
  assert.equal(lakhsToRupees(18460), 1846000000);
});

test('rupeesToCrore and formatCrore', () => {
  assert.equal(rupeesToCrore(1065122000), 106.5122);
  assert.equal(formatCrore(1065122000), '₹106.51cr');
  assert.equal(formatCrore(0), '₹0.00cr');
});

test('parseFilingAmount: strips separators, handles bracketed negatives', () => {
  assert.equal(parseFilingAmount('10,651.22'), 10651.22);
  assert.equal(parseFilingAmount('1,14,430'), 114430);       // Indian grouping
  assert.equal(parseFilingAmount('(434)'), -434);            // accounting negative
  assert.equal(parseFilingAmount(' 18,460 '), 18460);
});

test('parseFilingAmount: refuses anything that is not a number', () => {
  assert.equal(parseFilingAmount('-'), null);
  assert.equal(parseFilingAmount(''), null);
  assert.equal(parseFilingAmount('Revenue from operations'), null);
});

test('TARGET_LINE_ITEM: the two companies are nowcast on different lines', () => {
  assert.equal(TARGET_LINE_ITEM.TIPSMUSIC, 'revenue_from_operations');
  assert.equal(TARGET_LINE_ITEM.SAREGAMA, 'segment_revenue_music');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && npx -y tsx --test lib/financials.test.ts`
Expected: FAIL — cannot find module `./financials`

- [ ] **Step 3: Write the implementation**

```ts
// v2/lib/financials.ts
/**
 * Unit and label handling for reported financials.
 *
 * Indian filings report in LAKHS and group digits as 1,14,430. Both are easy to
 * get wrong silently — a lakhs/rupees slip is a factor of 100,000 — so the
 * conversion lives here and everything downstream deals only in rupees.
 */

/** Which reported line each company's nowcast is scored against. */
export const TARGET_LINE_ITEM: Record<string, string> = {
  TIPSMUSIC: 'revenue_from_operations',   // single segment, so this IS the music line
  SAREGAMA: 'segment_revenue_music',      // group revenue also contains films, video, events
};

export const lakhsToRupees = (n: number): number => Math.round(n * 100_000);
export const rupeesToCrore = (n: number): number => n / 10_000_000;

export function formatCrore(n: number): string {
  return `₹${rupeesToCrore(n).toFixed(2)}cr`;
}

/**
 * Parse an amount as printed in a filing table. Returns null for anything that
 * is not a number — a dash, a label, an empty cell — so a bad parse surfaces as
 * missing rather than as zero.
 */
export function parseFilingAmount(text: string): number | null {
  const t = text.trim();
  if (t === '' || t === '-' || t === '—') return null;
  const negative = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/[()]/g, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && npx -y tsx --test lib/financials.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
cd v2 && npx tsc --noEmit
cd .. && git add v2/lib/financials.ts v2/lib/financials.test.ts
git commit -m "Financial unit conversion and filing-amount parsing"
```

---

### Task 4: The nowcast model

**Files:**
- Create: `v2/lib/nowcast.ts`
- Test: `v2/lib/nowcast.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces: `NowcastDrivers {ownedViews, topicViews, ugcViews}`, `NowcastAssumptions {cpmLow, cpmMid, cpmHigh, nonYouTubeUplift, includeUgc}`, `NowcastBand {low, mid, high}`, `DriverContribution {driver, mid, pctOfMid}`, `NowcastResult {band, contributions, projectedViews, quarterProgress}`, `computeNowcast(opts): NowcastResult`, `DEFAULT_ASSUMPTIONS`

- [ ] **Step 1: Write the failing test**

```ts
// v2/lib/nowcast.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNowcast, DEFAULT_ASSUMPTIONS, type NowcastDrivers } from './nowcast';

const drivers: NowcastDrivers = {
  ownedViews: 1_000_000_000,
  topicViews: 400_000_000,
  ugcViews: 30_000_000,
};
const flat = { cpmLow: 100, cpmMid: 120, cpmHigh: 140, nonYouTubeUplift: 1, includeUgc: true };

test('computeNowcast: extrapolates quarter-to-date views to a full quarter', () => {
  const half = computeNowcast({ drivers, assumptions: flat, quarterProgress: 0.5 });
  const full = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  assert.equal(half.projectedViews, full.projectedViews * 2);
});

test('computeNowcast: band is CPM applied per 1,000 projected views', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  // 1.43bn views projected; at Rs120/1k that is Rs 171,600,000
  assert.equal(r.projectedViews, 1_430_000_000);
  assert.equal(r.band.mid, 171_600_000);
  assert.equal(r.band.low, 143_000_000);
  assert.equal(r.band.high, 200_200_000);
});

test('computeNowcast: excluding UGC removes it from the projection', () => {
  const withUgc = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  const without = computeNowcast({
    drivers, assumptions: { ...flat, includeUgc: false }, quarterProgress: 1,
  });
  assert.equal(withUgc.projectedViews - without.projectedViews, drivers.ugcViews);
});

test('computeNowcast: non-YouTube uplift scales the whole band', () => {
  const base = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  const up = computeNowcast({
    drivers, assumptions: { ...flat, nonYouTubeUplift: 1.5 }, quarterProgress: 1,
  });
  assert.equal(up.band.mid, base.band.mid * 1.5);
});

test('computeNowcast: contributions name each driver and sum to 100%', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 1 });
  assert.deepEqual(r.contributions.map((c) => c.driver), ['owned', 'topic', 'ugc']);
  const total = r.contributions.reduce((a, c) => a + c.pctOfMid, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.ok(r.contributions[0].pctOfMid > r.contributions[1].pctOfMid);
});

test('computeNowcast: zero progress yields no projection rather than Infinity', () => {
  const r = computeNowcast({ drivers, assumptions: flat, quarterProgress: 0 });
  assert.equal(r.projectedViews, 0);
  assert.equal(r.band.mid, 0);
});

test('computeNowcast: band is ordered low <= mid <= high', () => {
  const r = computeNowcast({ drivers, assumptions: DEFAULT_ASSUMPTIONS, quarterProgress: 0.65 });
  assert.ok(r.band.low <= r.band.mid && r.band.mid <= r.band.high);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && npx -y tsx --test lib/nowcast.test.ts`
Expected: FAIL — cannot find module `./nowcast`

- [ ] **Step 3: Write the implementation**

```ts
// v2/lib/nowcast.ts
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
  /** Quarter-to-date views on owned channels. */
  ownedViews: number;
  /** Quarter-to-date views attributed via Topic / OAC channels. */
  topicViews: number;
  /** Quarter-to-date UGC reach. A sampled lower bound. */
  ugcViews: number;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && npx -y tsx --test lib/nowcast.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
cd v2 && npx tsc --noEmit
cd .. && git add v2/lib/nowcast.ts v2/lib/nowcast.test.ts
git commit -m "Nowcast model: reach + owned assumptions -> revenue band"
```

---

### Task 5: The scoring loop

**Files:**
- Create: `v2/lib/scoring.ts`
- Test: `v2/lib/scoring.test.ts`

**Interfaces:**
- Consumes: `NowcastBand` from `./nowcast`
- Produces: `ScoredQuarter {fiscalLabel, estimate, actual, absError, pctError, withinBand}`, `scoreEstimate(estimate: NowcastBand, actual: number): {absError, pctError, withinBand}`, `summariseTrackRecord(scored: ScoredQuarter[]): TrackRecord`, `TrackRecord {n, hitRate, medianAbsPctError, worst}`

- [ ] **Step 1: Write the failing test**

```ts
// v2/lib/scoring.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEstimate, summariseTrackRecord, type ScoredQuarter } from './scoring';

const band = { low: 90, mid: 100, high: 110 };

test('scoreEstimate: error is measured against the band mid, as a share of the ACTUAL', () => {
  // Percentage error is conventionally relative to what actually happened (MAPE),
  // which is what a track record reports: 20 off a 120 print is 16.7%, not 20%.
  const s = scoreEstimate(band, 120);
  assert.equal(s.absError, 20);
  assert.equal(Number(s.pctError!.toFixed(4)), 16.6667);
  assert.equal(s.withinBand, false);
  assert.deepEqual(scoreEstimate(band, 100), { absError: 0, pctError: 0, withinBand: true });
});

test('scoreEstimate: within-band is inclusive of the edges', () => {
  assert.equal(scoreEstimate(band, 90).withinBand, true);
  assert.equal(scoreEstimate(band, 110).withinBand, true);
  assert.equal(scoreEstimate(band, 89.99).withinBand, false);
});

test('scoreEstimate: an actual of zero yields null pctError, not Infinity', () => {
  const s = scoreEstimate(band, 0);
  assert.equal(s.absError, 100);
  assert.equal(s.pctError, null);
});

test('summariseTrackRecord: empty history is reported as unproven, not as perfect', () => {
  const t = summariseTrackRecord([]);
  assert.equal(t.n, 0);
  assert.equal(t.hitRate, null);
  assert.equal(t.medianAbsPctError, null);
  assert.equal(t.worst, null);
});

test('summariseTrackRecord: hit rate and median absolute percentage error', () => {
  const rows: ScoredQuarter[] = [
    { fiscalLabel: 'FY26 Q1', estimate: band, actual: 100, absError: 0,  pctError: 0,   withinBand: true },
    { fiscalLabel: 'FY26 Q2', estimate: band, actual: 120, absError: 20, pctError: 20,  withinBand: false },
    { fiscalLabel: 'FY26 Q3', estimate: band, actual: 105, absError: 5,  pctError: 5,   withinBand: true },
  ];
  const t = summariseTrackRecord(rows);
  assert.equal(t.n, 3);
  assert.equal(Number(t.hitRate!.toFixed(4)), 0.6667);
  assert.equal(t.medianAbsPctError, 5);
  assert.equal(t.worst!.fiscalLabel, 'FY26 Q2');
});

test('summariseTrackRecord: median of an even count averages the middle two', () => {
  const mk = (label: string, pct: number): ScoredQuarter => ({
    fiscalLabel: label, estimate: band, actual: 100, absError: 0, pctError: pct, withinBand: true,
  });
  const t = summariseTrackRecord([mk('a', 2), mk('b', 4), mk('c', 6), mk('d', 8)]);
  assert.equal(t.medianAbsPctError, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v2 && npx -y tsx --test lib/scoring.test.ts`
Expected: FAIL — cannot find module `./scoring`

- [ ] **Step 3: Write the implementation**

```ts
// v2/lib/scoring.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v2 && npx -y tsx --test lib/scoring.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd v2 && npx tsc --noEmit
cd .. && git add v2/lib/scoring.ts v2/lib/scoring.test.ts
git commit -m "Scoring loop: estimate vs actual, and an unproven-by-default track record"
```

---

### Task 6: Nowcast time-series table

**Files:**
- Create: `v2/db/migrations/0028_revenue_nowcast.sql`

**Interfaces:**
- Consumes: `dim_company(company)`
- Produces: table `fct_revenue_nowcast(company, fiscal_label, asof, band_low_inr, band_mid_inr, band_high_inr, projected_views, quarter_progress, drivers, assumptions)`

- [ ] **Step 1: Write the migration**

```sql
-- v2/db/migrations/0028_revenue_nowcast.sql
-- =============================================================================
-- The nowcast as a TIME SERIES, not a single value.
--
-- One row per (company, fiscal quarter, as-of date). Watching the estimate move
-- as a quarter fills in is most of its diagnostic value: a nowcast that swings
-- wildly late in a quarter is telling you something a final number would hide.
--
-- drivers and assumptions are stored alongside each estimate so a past figure
-- can always be explained, even after the model or the defaults change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_revenue_nowcast (
  company          text NOT NULL REFERENCES dim_company(company),
  fiscal_label     text NOT NULL,          -- 'FY27 Q2'
  asof             date NOT NULL,
  band_low_inr     numeric NOT NULL,
  band_mid_inr     numeric NOT NULL,
  band_high_inr    numeric NOT NULL,
  projected_views  bigint  NOT NULL,
  quarter_progress numeric NOT NULL,
  drivers          jsonb   NOT NULL,
  assumptions      jsonb   NOT NULL,
  ingest_run_id    bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, fiscal_label, asof)
);

ALTER TABLE fct_revenue_nowcast DROP CONSTRAINT IF EXISTS fct_revenue_nowcast_band_chk;
ALTER TABLE fct_revenue_nowcast ADD CONSTRAINT fct_revenue_nowcast_band_chk
  CHECK (band_low_inr <= band_mid_inr AND band_mid_inr <= band_high_inr);

ALTER TABLE fct_revenue_nowcast DROP CONSTRAINT IF EXISTS fct_revenue_nowcast_progress_chk;
ALTER TABLE fct_revenue_nowcast ADD CONSTRAINT fct_revenue_nowcast_progress_chk
  CHECK (quarter_progress > 0 AND quarter_progress <= 1);

CREATE INDEX IF NOT EXISTS idx_revenue_nowcast_latest
  ON fct_revenue_nowcast (company, fiscal_label, asof DESC);

ALTER TABLE fct_revenue_nowcast ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_revenue_nowcast FROM anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply with Supabase MCP `apply_migration`, project `bfafqccvzboyfjewzvhk`, name `0028_revenue_nowcast`.

- [ ] **Step 3: Verify the constraints bite**

Run with `execute_sql` — this MUST fail:

```sql
INSERT INTO fct_revenue_nowcast
  (company, fiscal_label, asof, band_low_inr, band_mid_inr, band_high_inr,
   projected_views, quarter_progress, drivers, assumptions)
VALUES ('TIPSMUSIC','FY27 Q2','2026-08-29', 200, 100, 300, 1, 0.5, '{}', '{}');
```

Expected: ERROR on `fct_revenue_nowcast_band_chk`. If it succeeds, the constraint is wrong — stop and fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add v2/db/migrations/0028_revenue_nowcast.sql
git commit -m "0028: nowcast stored as a time series with its drivers and assumptions"
```

---

### Task 7: Query layer — inputs, persistence and track record

**Files:**
- Modify: `v2/lib/queries.ts` (append a new section before `export async function getOpsRunHistory`)

**Interfaces:**
- Consumes: `fiscalQuarterOf`, `quarterProgress` from `./fiscal`; `computeNowcast`, `DEFAULT_ASSUMPTIONS`, types from `./nowcast`; `scoreEstimate`, `summariseTrackRecord` from `./scoring`; `TARGET_LINE_ITEM` from `./financials`
- Produces: `getNowcastDrivers(opts: {company: Company; from: string; to: string}): Promise<NowcastDrivers>`, `storeNowcast(opts): Promise<void>`, `getTrackRecord(company: Company): Promise<TrackRecord>`

- [ ] **Step 1: Add the imports**

At the top of `v2/lib/queries.ts`, immediately after the existing `import { ... } from '@/lib/correlation';` block, add:

```ts
import { fiscalQuarterOf, quarterProgress, type FiscalQuarter } from '@/lib/fiscal';
import {
  computeNowcast,
  DEFAULT_ASSUMPTIONS,
  type NowcastAssumptions,
  type NowcastDrivers,
} from '@/lib/nowcast';
import { scoreEstimate, summariseTrackRecord, type ScoredQuarter, type TrackRecord } from '@/lib/scoring';
import { TARGET_LINE_ITEM } from '@/lib/financials';
```

- [ ] **Step 2: Add the query functions**

Insert immediately before `export async function getOpsRunHistory`:

```ts
// ---- Nowcast spine ---------------------------------------------------------

/**
 * Quarter-to-date reach per driver.
 *
 * Owned views come from v_company_daily. Topic and UGC reuse the existing
 * getTopicReach / getUGCReach snapshots rather than recomputing attribution —
 * one definition of attributed reach, not two.
 */
export async function getNowcastDrivers(opts: {
  company: Company;
  from: string;
  to: string;
}): Promise<NowcastDrivers> {
  const supabase = getServiceSupabase();
  const [{ data: owned }, topic, ugc] = await Promise.all([
    supabase
      .from('v_company_daily')
      .select('daily_views')
      .eq('company', opts.company)
      .gte('date', opts.from)
      .lte('date', opts.to),
    getTopicReach({ company: opts.company, days: 120 }),
    getUGCReach({ company: opts.company }),
  ]);

  const ownedViews = ((owned ?? []) as Array<{ daily_views: number | null }>).reduce(
    (a, r) => a + Number(r.daily_views ?? 0),
    0,
  );

  // TopicReachSnapshot exposes a daily `series`, not a period total — sum the
  // days inside this quarter rather than reusing totals.last_30d, which is a
  // rolling window and would not line up with the quarter boundary.
  const topicViews = topic.series
    .filter((d) => d.date >= opts.from && d.date <= opts.to)
    .reduce((a, d) => a + Number(d.attributed_daily_views ?? 0), 0);

  // UGC reach is a CUMULATIVE discovered figure, not a per-quarter flow, so it
  // must not be extrapolated by quarter progress — doing so would inflate the
  // estimate by roughly 1/progress. Reported as 0 until UGC is measured as a
  // flow; `includeUgc` stays in the model for when it can be.
  void ugc;

  return { ownedViews, topicViews, ugcViews: 0 };
}

/** Append today's estimate. Idempotent per (company, quarter, asof). */
export async function storeNowcast(opts: {
  company: Company;
  asof: string;
  assumptions?: NowcastAssumptions;
  ingestRunId?: number;
}): Promise<{ fiscal: FiscalQuarter; mid: number }> {
  const supabase = getServiceSupabase();
  const fiscal = fiscalQuarterOf(opts.asof);
  const assumptions = opts.assumptions ?? DEFAULT_ASSUMPTIONS;

  const drivers = await getNowcastDrivers({
    company: opts.company,
    from: fiscal.start,
    to: opts.asof,
  });
  const result = computeNowcast({
    drivers,
    assumptions,
    quarterProgress: quarterProgress(opts.asof),
  });

  const { error } = await supabase.from('fct_revenue_nowcast').upsert(
    {
      company: opts.company,
      fiscal_label: fiscal.label,
      asof: opts.asof,
      band_low_inr: Math.round(result.band.low),
      band_mid_inr: Math.round(result.band.mid),
      band_high_inr: Math.round(result.band.high),
      projected_views: Math.round(result.projectedViews),
      quarter_progress: result.quarterProgress,
      drivers,
      assumptions,
      ingest_run_id: opts.ingestRunId ?? null,
    },
    { onConflict: 'company,fiscal_label,asof' },
  );
  if (error) throw new Error(`storeNowcast upsert: ${error.message}`);
  return { fiscal, mid: result.band.mid };
}

/**
 * Score every quarter where a CONFIRMED actual exists and a pre-print estimate
 * was made. Unconfirmed financials are excluded — a misparsed line would poison
 * the record permanently.
 */
export async function getTrackRecord(company: Company): Promise<TrackRecord> {
  const supabase = getServiceSupabase();
  const [{ data: actuals }, { data: estimates }] = await Promise.all([
    supabase
      .from('fct_reported_financials')
      .select('fiscal_label, value_inr')
      .eq('company', company)
      .eq('line_item', TARGET_LINE_ITEM[company])
      .not('confirmed_by', 'is', null),
    supabase
      .from('fct_revenue_nowcast')
      .select('fiscal_label, asof, band_low_inr, band_mid_inr, band_high_inr')
      .eq('company', company)
      .order('asof', { ascending: true }),
  ]);

  // The estimate that counts is the last one made before the quarter closed.
  const lastByQuarter = new Map<string, { low: number; mid: number; high: number }>();
  for (const e of (estimates ?? []) as Array<{
    fiscal_label: string; band_low_inr: number; band_mid_inr: number; band_high_inr: number;
  }>) {
    lastByQuarter.set(e.fiscal_label, {
      low: Number(e.band_low_inr),
      mid: Number(e.band_mid_inr),
      high: Number(e.band_high_inr),
    });
  }

  const scored: ScoredQuarter[] = [];
  for (const a of (actuals ?? []) as Array<{ fiscal_label: string; value_inr: number }>) {
    const estimate = lastByQuarter.get(a.fiscal_label);
    if (!estimate) continue;             // never estimated — not a miss, just absent
    const actual = Number(a.value_inr);
    scored.push({ fiscalLabel: a.fiscal_label, estimate, actual, ...scoreEstimate(estimate, actual) });
  }
  return summariseTrackRecord(scored);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd v2 && npx tsc --noEmit`
Expected: no output. If `Company` is unresolved, it is already declared in `queries.ts` — do not redeclare it.

- [ ] **Step 4: Run the full suite to confirm nothing regressed**

Run: `cd v2 && npx -y tsx --test lib/*.test.ts`
Expected: all tests pass (154 existing + 24 new from Tasks 1, 3, 4, 5)

- [ ] **Step 5: Commit**

```bash
git add v2/lib/queries.ts
git commit -m "Query layer for nowcast drivers, persistence and track record"
```

---

### Task 8: Daily nowcast cron

**Files:**
- Create: `v2/app/api/cron/nowcast/route.ts`
- Modify: `v2/vercel.json` (add one cron entry)

**Interfaces:**
- Consumes: `storeNowcast` from `@/lib/queries`; `requireCronAuth` from `@/lib/cron-auth`; `bumpTags`, `CACHE_TAGS` from `@/lib/revalidate`
- Produces: `GET /api/cron/nowcast`

- [ ] **Step 1: Write the route**

```ts
// v2/app/api/cron/nowcast/route.ts
import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { getServiceSupabase } from '@/lib/supabase/server';
import { storeNowcast } from '@/lib/queries';
import { bumpTags, CACHE_TAGS } from '@/lib/revalidate';

export const maxDuration = 120;

/**
 * Appends today's revenue nowcast for each company.
 *
 * Runs daily so the estimate is a time series: how it moves as the quarter
 * fills in is most of its diagnostic value. Per-company failures are logged and
 * do not fail the run — the same posture as the other ingest crons.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = getServiceSupabase();
  const asof = new Date().toISOString().slice(0, 10);

  const { data: runRow, error: runErr } = await supabase
    .from('ops_ingest_run')
    .insert({ source: 'nowcast', status: 'running' })
    .select('run_id')
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: `Could not open ingest_run: ${runErr?.message}` },
      { status: 500 },
    );
  }
  const runId = runRow.run_id as number;

  const results: Array<{ company: string; ok: boolean; detail: string }> = [];
  for (const company of ['TIPSMUSIC', 'SAREGAMA'] as const) {
    try {
      const { fiscal, mid } = await storeNowcast({ company, asof, ingestRunId: runId });
      results.push({ company, ok: true, detail: `${fiscal.label} mid=${Math.round(mid)}` });
    } catch (err) {
      const message = (err as Error).message;
      results.push({ company, ok: false, detail: message });
      await supabase.from('ops_error_log').insert({
        error_type: 'nowcast_failed',
        error_message: message,
        detail: { company, asof },
        ingest_run_id: runId,
      });
    }
  }

  const written = results.filter((r) => r.ok).length;
  await supabase
    .from('ops_ingest_run')
    .update({
      ended_at: new Date().toISOString(),
      status: written === results.length ? 'ok' : written > 0 ? 'partial' : 'failed',
      rows_in: results.length,
      rows_out: written,
      detail: { asof, results },
    })
    .eq('run_id', runId);

  if (written > 0) bumpTags(CACHE_TAGS.overview, CACHE_TAGS.ops);

  return NextResponse.json({ ok: written > 0, asof, run_id: runId, results });
}
```

- [ ] **Step 2: Register the cron**

In `v2/vercel.json`, add this entry to the `crons` array immediately after the `/api/cron/youtube-videos` line:

```json
    { "path": "/api/cron/nowcast",            "schedule": "30 1 * * *"     },
```

It runs at 01:30 UTC, after `youtube-videos` at 01:00, so each estimate uses the day's fresh reach.

- [ ] **Step 3: Verify the build**

Run:

```bash
cd v2 && SUPABASE_URL="https://placeholder.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="placeholder_service_role_key_0000000000" \
  CRON_SECRET="placeholder_cron_secret_000" \
  YOUTUBE_API_KEY="placeholder_youtube_api_key_00000000" \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk" \
  CLERK_SECRET_KEY="sk_test_placeholder000000000000000000000" \
  NEXT_PUBLIC_APP_URL="http://localhost:3000" npx next build
```

Expected: `✓ Compiled successfully`, and `/api/cron/nowcast` listed in the route table. The local `.env.local` holds empty values, so placeholder env is required for any local build.

- [ ] **Step 4: Commit**

```bash
git add v2/app/api/cron/nowcast/route.ts v2/vercel.json
git commit -m "Daily nowcast cron appending each company's estimate"
```

---

### Task 9: End-to-end verification against production data

**Files:**
- None created. This task proves the spine works on real data.

**Interfaces:**
- Consumes: everything built above

- [ ] **Step 1: Generate an estimate for today**

In a Node one-off from `v2/`, or by invoking the deployed cron with the `CRON_SECRET` bearer token, produce a row for each company. Then verify with `execute_sql`:

```sql
SELECT company, fiscal_label, asof, quarter_progress,
       (band_low_inr/1e7)::numeric(10,2)  AS low_cr,
       (band_mid_inr/1e7)::numeric(10,2)  AS mid_cr,
       (band_high_inr/1e7)::numeric(10,2) AS high_cr,
       projected_views
  FROM fct_revenue_nowcast ORDER BY company, asof DESC LIMIT 4;
```

Expected: two rows, `fiscal_label = 'FY27 Q2'`, `quarter_progress` ≈ 0.65 in late August.

- [ ] **Step 2: Sanity-check the magnitude against a known actual**

Tips printed ₹106.51cr for FY27 Q1. A projected full-quarter estimate wildly outside roughly ₹60–200cr means an assumption is wrong — most likely `nonYouTubeUplift` or the CPM band. Record what you find; do not tune the model to hit the number, since that would destroy the value of the track record.

- [ ] **Step 3: Confirm the track record reports as unproven**

```sql
SELECT COUNT(*) FROM fct_revenue_nowcast n
  JOIN fct_reported_financials f
    ON f.company = n.company AND f.fiscal_label = n.fiscal_label
 WHERE f.confirmed_by IS NOT NULL;
```

Expected: **0**. No estimate exists yet for a quarter that has already printed, so `getTrackRecord` must return `{n: 0, hitRate: null, ...}`. That is the correct day-one state and the UI is required to say so.

- [ ] **Step 4: Run the full suite and typecheck one final time**

```bash
cd v2 && npx tsc --noEmit && npx -y tsx --test lib/*.test.ts
```

Expected: tsc silent; all tests pass.

- [ ] **Step 5: Commit any notes and push**

```bash
git add -A
git commit -m "Verify nowcast spine against production data"
git push origin deploy/dashboard-rebuild
```

---

## Explicitly out of scope

**Automated PDF extraction.** The spec calls extraction assistive; this plan
delivers the storage, the units, the amount parser and the confirmation gate,
and seeds the eight figures already read off the Q1 FY27 filings. Parsing the
BSE PDFs programmatically is a separate piece of work with its own failure
modes — `WebFetch` could not read them (FlateDecode streams), so it needs a real
PDF library and its own golden-file tests. Eight confirmed figures is enough to
build and verify the spine; a track record needs more, and that backfill is the
first task of any follow-up plan.

## Notes for the executor

- **Do not tune the model to match a known actual.** The whole design rests on the track record being an honest out-of-sample measure. A model fitted to the four figures we already have would show a flattering error and mean nothing.
- **`lib/queries.ts` is `server-only`.** Any runtime value a future client component needs must live in its own module (see `lib/metrics.ts` for the pattern). Types may be imported from `queries.ts` because they are erased at compile time; constants may not. `tsc` will not catch this — only `next build` will.
- **`ops_ingest_run.run_id` is `bigint`, so `as number` is correct.**
  `app/api/cron/youtube-channels/route.ts` casts it `as string`; that is a
  pre-existing mistake in the repo, harmless because the value is only passed
  through. Do not copy it.
- **Migration files must match what was applied.** If you change SQL after applying it, apply the corrected version and update the file, so a rebuild from the repo reproduces the same database.
