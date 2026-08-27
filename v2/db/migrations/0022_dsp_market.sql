-- =============================================================================
-- Tusk YT v2 — India DSP market + paid-migration layer (B1)
--
-- Two manually-curated, source-cited tables (same posture as dim_broker /
-- fct_broker_estimate — episodic operator inserts, NOT cron-fed):
--
--   dim_dsp         — registry of India music DSPs with current status/owner.
--   fct_dsp_market  — the canonical India TAM + paid-migration time series
--                     (paid subs, subscription revenue, total recorded-music
--                     revenue, penetration, per-stream rates).
--
-- PURPOSE — this is a GRADED SECTOR-TAILWIND / PAID-MIGRATION layer, NOT
-- company alpha. There is no public per-catalog DSP stream data, so this layer
-- tells us whether the *pie* is growing and shifting to paid; per-company
-- capture still comes from YouTube + disclosed earnings. Every row carries a
-- source_url and a confidence flag ('reported' | 'estimate' | 'forecast').
--
-- Key anchor (EY-FICCI M&E report, Apr 2026): India hit 14.4m paid music subs
-- in 2025 (+37% YoY); subscription revenue ₹10.3bn; total recorded music ₹59bn;
-- forecast 28-30m paid subs by 2028. India revenue was ~flat for 18 months to
-- mid-2025 (IFPI) — the thesis is monetisation MIX, not user volume.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dim_dsp (
  dsp            text PRIMARY KEY,            -- 'spotify' | 'jiosaavn' | ...
  display_name   text NOT NULL,
  owner          text,                         -- parent / controlling entity
  status         text NOT NULL DEFAULT 'active', -- see CHECK
  status_asof    date,                         -- when the status last changed
  country        text NOT NULL DEFAULT 'IN',
  display_order  int,
  notes          text,
  source_url     text,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dim_dsp DROP CONSTRAINT IF EXISTS dim_dsp_status_chk;
ALTER TABLE dim_dsp ADD CONSTRAINT dim_dsp_status_chk
  CHECK (status IN ('active', 'paywall', 'restructuring', 'shutdown'));

CREATE TABLE IF NOT EXISTS fct_dsp_market (
  asof        date NOT NULL,        -- period the metric refers to (year-end for annual)
  scope       text NOT NULL DEFAULT 'india',  -- 'india' | 'global'
  metric      text NOT NULL,        -- see seed for the controlled vocabulary
  value       numeric NOT NULL,
  unit        text NOT NULL,        -- 'count' | 'inr' | 'usd' | 'pct' | 'rank'
  source      text NOT NULL,        -- 'EY-FICCI' | 'IFPI' | 'IMI' | 'Sharekhan' | ...
  source_url  text,
  confidence  text NOT NULL DEFAULT 'reported', -- 'reported' | 'estimate' | 'forecast'
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asof, scope, metric, source)
);

ALTER TABLE fct_dsp_market DROP CONSTRAINT IF EXISTS fct_dsp_market_conf_chk;
ALTER TABLE fct_dsp_market ADD CONSTRAINT fct_dsp_market_conf_chk
  CHECK (confidence IN ('reported', 'estimate', 'forecast'));

CREATE INDEX IF NOT EXISTS idx_fct_dsp_market_metric
  ON fct_dsp_market (metric, scope, asof DESC);

ALTER TABLE dim_dsp        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_dsp_market ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dim_dsp, fct_dsp_market FROM anon, authenticated;

-- --- Seed: DSP registry (corrected to mid-2026 reality) --------------------
INSERT INTO dim_dsp (dsp, display_name, owner, status, status_asof, display_order, notes, source_url) VALUES
  ('spotify',       'Spotify',        'Spotify Technology S.A.', 'active',        '2019-02-26', 10,
    'Largest pure-play paid base in India (~3m paid est.); India inside "Rest of World" in filings. India subs "grown sevenfold" (Spotify 2026 Investor Day).',
    'https://newsroom.spotify.com/2026-05-21/investor-day-recap/'),
  ('youtube_music', 'YouTube Music',  'Google / Alphabet',       'active',        NULL, 20,
    'Dominant by stream volume in India; Premium Lite launched in India 2025-09-29 at ₹89/mo. Global YT Music+Premium >125m (Sep-2025), no India split.',
    'https://blog.google/intl/en-in/products/platforms/youtube-premium-lite-arrives-in-india/'),
  ('jiosaavn',      'JioSaavn',       'Reliance / Jio Platforms', 'active',       NULL, 30,
    'Top-two by reach (100m+ MAU est.). Pro bundled across Jio''s 400m+ telecom base — bundling is its main paid-conversion lever.',
    'https://expandedramblings.com/index.php/saavn-statistics-and-facts/'),
  ('apple_music',   'Apple Music',    'Apple Inc.',               'active',       NULL, 40,
    'Bundled via Airtel (postpaid Feb-2025, prepaid mid-2025) — the de-facto Wynk successor. No India subs disclosed.',
    'https://www.airtel.in/press-release/02-2025/airtel-and-apple-enter-into-a-strategic-partnership-to-exclusively-offer-apple-tv-and-apple-music-to-its-wi-fi-and-postpaid-customers/'),
  ('amazon_music',  'Amazon Music',   'Amazon',                   'restructuring','2026-07-02', 50,
    'NOT shut down. From 2026-07-02: standalone with new ad-supported Free tier + paid Unlimited (₹99 Prime / ₹119 non-Prime); ad-free music removed from Prime. A free→paid move.',
    'https://www.musicbusinessworldwide.com/amazon-music-goes-standalone-in-india-with-1-unlimited-tier-for-prime-members-as-they-lose-ad-free-listening/'),
  ('gaana',         'Gaana',          'ENIL (Times Group)',       'paywall',      '2023-12-01', 60,
    'Free tier removed Sep-2022; transferred to ENIL Dec-2023. Now a small paid-only niche: >1m subs, ~15% CAGR, ~₹112cr FY26 revenue (CEO, May-2026). Downsized, not dead.',
    'https://musically.com/2026/05/28/gaanas-subscribers-are-growing-at-the-rate-of-15-per-year-says-ceo/'),
  ('wynk',          'Wynk Music',     'Bharti Airtel',            'shutdown',     '2024-11-01', 70,
    'CONFIRMED shutdown Nov-2024 (low monetisation). Airtel partnered with APPLE Music (not Spotify) as the replacement.',
    'https://developingtelecoms.com/telecom-technology/telecom-devices-platforms/17223-airtel-to-drop-wynk-music-after-signing-content-deal-with-apple.html'),
  ('resso',         'Resso',          'ByteDance',                'shutdown',     '2024-01-01', 80,
    'Went premium-only 2023, exited India Jan-2024. Part of the free-tier consolidation wave.',
    'https://musically.com/2025/04/02/shut-downs-watching-vs-listening-and-future-growth-indias-dsp-market-today/'),
  ('hungama',       'Hungama Music',  'Hungama Digital Media',    'shutdown',     '2025-04-15', 90,
    'Shut down 2025-04-15 (pivoted to B2B); third major Indian DSP to fold in ~18 months.',
    'https://musically.com/2025/04/02/shut-downs-watching-vs-listening-and-future-growth-indias-dsp-market-today/')
ON CONFLICT (dsp) DO NOTHING;

-- --- Seed: India market time series (paid-migration thesis) ----------------
-- EY-FICCI M&E report (published Apr 2026; reports 2025 data).
INSERT INTO fct_dsp_market (asof, scope, metric, value, unit, source, source_url, confidence, notes) VALUES
  ('2025-12-31', 'india', 'paid_subscriptions',          14400000,    'count', 'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'reported',
    '+37% YoY (added ~4m). ≈8% of 178m streamers.'),
  ('2025-12-31', 'india', 'paid_subs_yoy_pct',           37,          'pct',   'EY-FICCI',
    'https://musically.com/2026/04/14/india-grew-its-paid-music-subscriptions-by-37-to-14m-in-2025/', 'reported', NULL),
  ('2025-12-31', 'india', 'paid_share_of_streamers_pct', 8,           'pct',   'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'reported',
    '14.4m paid / 178m streamers.'),
  ('2025-12-31', 'india', 'subscription_revenue_inr',    10300000000, 'inr',   'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'reported',
    '₹10.3bn — crossed ₹10bn for the first time.'),
  ('2025-12-31', 'india', 'recorded_music_revenue_inr',  59000000000, 'inr',   'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'reported',
    '₹59bn (~$677m). 2024 was ~₹53bn; 2024 dipped ~2% during the free→paid J-curve.'),
  ('2025-12-31', 'india', 'total_streams',               6000000000000,'count','EY-FICCI',
    'https://www.thestreaminglab.com/p/why-indias-music-streaming-scene', 'estimate',
    '~6 trillion streams (+15% YoY).'),
  ('2025-12-31', 'india', 'paid_streams',                164000000000, 'count','EY-FICCI',
    'https://www.thestreaminglab.com/p/why-indias-music-streaming-scene', 'estimate',
    '~164bn paid streams = <3% of total. Free/ad-funded dominates volume.'),
  ('2024-12-31', 'india', 'paid_subscriptions',          10400000,    'count', 'EY-FICCI',
    'https://musically.com/2026/04/14/india-grew-its-paid-music-subscriptions-by-37-to-14m-in-2025/', 'reported',
    'Prior-year base.'),
  ('2022-12-31', 'india', 'paid_subscriptions',          4600000,     'count', 'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'reported',
    'Earlier base for trajectory.'),
  -- IFPI Global Music Report 2026 (Mar 2026).
  ('2025-06-30', 'india', 'market_rank_global',          15,          'rank',  'IFPI',
    'https://musically.com/2025/12/18/25-insights-about-indias-music-industry-in-2025/', 'reported',
    'India 15th by recorded-music revenue; ~flat for 18 months to mid-2025 (IFPI CEO).'),
  ('2025-08-01', 'india', 'recorded_music_revenue_inr',  35000000000, 'inr',   'IMI',
    'https://musically.com/2025/12/18/25-insights-about-indias-music-industry-in-2025/', 'estimate',
    'IMI/Mehra ~₹3,500cr — NARROWER definition than EY-FICCI ₹59bn; kept for cross-check, not the headline.'),
  -- Per-stream economics (Sharekhan / HDFC broker notes, 2024).
  ('2024-08-09', 'india', 'per_stream_free_inr',         0.10,        'inr',   'Sharekhan',
    'https://www.sharekhan.com/MediaGalary/Equity/SaReGaMa-3R-Aug09_2024.pdf', 'reported',
    '₹0.10/stream on free platforms with min-guarantee; ~50% of subscription revenue distributed to labels.'),
  -- Forecasts (EY-FICCI to 2028).
  ('2028-12-31', 'india', 'paid_subscriptions',          29000000,    'count', 'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'forecast',
    'Forecast 28-30m by 2028 (≈doubling). Midpoint stored.'),
  ('2028-12-31', 'india', 'subscription_revenue_inr',    22000000000, 'inr',   'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'forecast',
    '~₹22bn by 2028 (>2× 2025).'),
  ('2028-12-31', 'india', 'recorded_music_revenue_inr',  75000000000, 'inr',   'EY-FICCI',
    'https://www.musicbusinessworldwide.com/india-added-nearly-4m-paid-music-streaming-subscriptions-in-2025-taking-its-total-to-14-4m-according-to-new-report/', 'forecast',
    '~₹75bn by 2028 at ~9% CAGR.')
ON CONFLICT (asof, scope, metric, source) DO NOTHING;
