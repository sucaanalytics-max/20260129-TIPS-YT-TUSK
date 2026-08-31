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
