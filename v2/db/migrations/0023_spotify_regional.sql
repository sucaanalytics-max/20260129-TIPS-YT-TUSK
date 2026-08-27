-- =============================================================================
-- Tusk YT v2 — Spotify regional disclosure (B2)
--
-- The ONLY public source that measures actual PAID subscribers touching India.
-- Spotify discloses MAU + Premium subscribers by four regions only — Europe,
-- North America, Latin America, and "Rest of World" — and India sits inside
-- Rest of World (RoW). So RoW is a NOISY India proxy (RoW is Spotify's largest
-- *user* region but smallest *paying* region), but it is the only true paid
-- signal available and serves as BACKTEST GROUND TRUTH for the demand layer.
--
-- Manually entered each quarter from Spotify's shareholder letter / SEC 6-K.
-- =============================================================================

CREATE TABLE IF NOT EXISTS fct_spotify_regional (
  asof              date PRIMARY KEY,   -- quarter-end the figures refer to
  mau_total         bigint,             -- global monthly active users
  premium_total     bigint,             -- global paying subscribers
  -- Premium-subscriber mix by region (sum ≈ 100). India ⊂ row_*.
  premium_europe_pct numeric(5, 2),
  premium_na_pct     numeric(5, 2),
  premium_latam_pct  numeric(5, 2),
  premium_row_pct    numeric(5, 2),
  mau_row_pct        numeric(5, 2),     -- RoW share of MAU (skews higher than premium)
  source_url        text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fct_spotify_regional ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fct_spotify_regional FROM anon, authenticated;

-- --- Seed: recent quarters --------------------------------------------------
INSERT INTO fct_spotify_regional
  (asof, mau_total, premium_total, premium_europe_pct, premium_na_pct, premium_latam_pct, premium_row_pct, mau_row_pct, source_url, notes)
VALUES
  ('2025-09-30', 713000000, 281000000, NULL, NULL, NULL, NULL, NULL,
    'https://musically.com/2025/11/04/spotify-grows-to-713m-users-and-281m-subscribers/',
    'Prior-quarter totals for trajectory.'),
  ('2026-03-31', 761000000, 293000000, 36.0, 25.0, 24.0, 15.0, 37.0,
    'https://www.sec.gov/Archives/edgar/data/0001639920/000162828026027951/spot-20260331x6xk.htm',
    'Q1 2026: MAU +12% YoY, Premium +9% YoY (+3m QoQ). RoW ≈15% of Premium (≈44m subs) but ≈37% of MAU — India is the bulk of RoW. Region mix from MBW/Music Ally recaps of the 6-K.')
ON CONFLICT (asof) DO NOTHING;
