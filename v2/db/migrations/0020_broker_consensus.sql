-- =============================================================================
-- Tusk YT v2 — Broker consensus tracking
--
-- Manually-curated dataset of sell-side analyst reports on TIPSMUSIC and
-- SAREGAMA. Updates are episodic (a few times per quarter per broker) so
-- this isn't a cron-fed table — operators insert rows as new reports
-- land. Source URLs are stored for audit / re-verification.
--
-- The purpose: side-by-side our modelled YT-derived revenue band against
-- what the consensus is implying via P/E or DCF targets. Two things this
-- enables:
--   1. Detect when our model's signal direction diverges from broker
--      consensus (broker may revise next quarter; we'd see it first).
--   2. Quantify "differentiated coverage": no broker explicitly models
--      YouTube as a discrete revenue line, so our cockpit is net-additive
--      to anything Tusk's clients see from sell-side.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dim_broker (
  broker_name    text PRIMARY KEY,
  broker_type    text NOT NULL DEFAULT 'institutional', -- 'institutional' | 'retail'
  display_order  int,
  notes          text,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dim_broker
  DROP CONSTRAINT IF EXISTS dim_broker_type_chk;
ALTER TABLE dim_broker
  ADD CONSTRAINT dim_broker_type_chk
  CHECK (broker_type IN ('institutional', 'retail'));

CREATE TABLE IF NOT EXISTS fct_broker_estimate (
  broker_name           text NOT NULL REFERENCES dim_broker(broker_name),
  company               text NOT NULL REFERENCES dim_company(company),
  asof                  date NOT NULL,   -- date of the broker report
  rating                text NOT NULL,   -- 'BUY' | 'ADD' | 'HOLD' | 'REDUCE' | 'SELL'
  target_price_inr      numeric(10, 2),
  current_price_inr     numeric(10, 2),  -- as of the report's publication
  methodology           text,            -- 'DCF' | 'P/E' | 'SOTP' | free-form
  -- {FY26: 10.3, FY27: 13.1, FY28: 16.0} etc — flexible across brokers
  fy_eps_estimates_inr  jsonb,
  revenue_cagr_pct      numeric(5, 2),   -- e.g. 25.00 for 25% CAGR
  pat_cagr_pct          numeric(5, 2),
  notes                 text,
  source_url            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broker_name, company, asof)
);

ALTER TABLE fct_broker_estimate
  DROP CONSTRAINT IF EXISTS fct_broker_estimate_rating_chk;
ALTER TABLE fct_broker_estimate
  ADD CONSTRAINT fct_broker_estimate_rating_chk
  CHECK (rating IN ('BUY', 'ADD', 'ACCUMULATE', 'HOLD', 'NEUTRAL', 'REDUCE', 'SELL'));

CREATE INDEX IF NOT EXISTS idx_fct_broker_estimate_company_asof
  ON fct_broker_estimate (company, asof DESC);

ALTER TABLE dim_broker          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fct_broker_estimate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dim_broker, fct_broker_estimate FROM anon, authenticated;

-- --- Seed: brokers ---------------------------------------------------------
INSERT INTO dim_broker (broker_name, broker_type, display_order) VALUES
  ('JM Financial',           'institutional', 10),
  ('Nuvama',                 'institutional', 20),
  ('Sharekhan',              'institutional', 30),
  ('HDFC Securities',        'institutional', 40),
  ('Emkay Global',           'institutional', 50),
  ('ICICI Direct',           'retail',        60),
  ('FundsIndia',             'retail',        70),
  ('Ventura Securities',     'retail',        80)
ON CONFLICT (broker_name) DO NOTHING;

-- --- Seed: TIPSMUSIC broker history ----------------------------------------
INSERT INTO fct_broker_estimate
  (broker_name, company, asof, rating, target_price_inr, methodology, revenue_cagr_pct, pat_cagr_pct, notes, source_url)
VALUES
  ('Ventura Securities', 'TIPSMUSIC', '2024-01-12', 'BUY', 612, NULL, NULL, NULL,
    'Retail house; pre-split context',
    'https://trendlyne.com/research-reports/stock/1401/TIPSMUSIC/tips-music-ltd/'),
  ('FundsIndia', 'TIPSMUSIC', '2025-05-05', 'BUY', 746, NULL, NULL, NULL,
    'Retail house, methodology not disclosed',
    'https://trendlyne.com/research-reports/stock/1401/TIPSMUSIC/tips-music-ltd/'),
  ('JM Financial', 'TIPSMUSIC', '2025-07-01', 'BUY', 800, 'DCF (15y, WACC 12%, Tg 5%)', 25.00, 24.00,
    'Initiation. Warner deal expected 30%+ revenue contribution in FY26. Catalog recency advantage cited vs Saregama.',
    'https://rakesh-jhunjhunwala.in/tips-music-is-poised-for-growth-even-in-a-turbulent-industry-landscape-buy-for-target-price-of-%E2%82%B9800-24-upside-jmfics/'),
  ('JM Financial', 'TIPSMUSIC', '2026-01-09', 'ADD', 560, 'DCF', NULL, NULL,
    'Downgraded BUY → ADD. Cited "YouTube per-stream realisations significantly lower" than paid streaming as thesis risk. Muted FY26 new-content pipeline.',
    'https://www.business-standard.com/markets/news/tips-music-stock-downgraded-to-add-by-jm-financial-check-target-price-126010900294_1.html'),
  ('JM Financial', 'TIPSMUSIC', '2026-04-24', 'ADD', 730, '32x P/E', 20.00, NULL,
    'Post Q4 FY26 results. EPS FY27/28 raised 12-15%. Margin assumptions +500bps but flagged as unsustainable. 32.4% YoY revenue growth driven by 90s repertoire.',
    'https://www.business-standard.com/management/news/tips-music-extends-rally-on-strong-q4-up-15-in-2-days-jm-financial-retains-add-126042400259_1.html')
ON CONFLICT (broker_name, company, asof) DO NOTHING;

-- --- Seed: SAREGAMA broker history -----------------------------------------
INSERT INTO fct_broker_estimate
  (broker_name, company, asof, rating, target_price_inr, methodology, revenue_cagr_pct, pat_cagr_pct, notes, source_url)
VALUES
  ('ICICI Direct', 'SAREGAMA', '2023-05-23', 'BUY', 400, NULL, NULL, NULL, NULL,
    'https://trendlyne.com/research-reports/post/SAREGAMA/1185/saregama-india-ltd/'),
  ('ICICI Direct', 'SAREGAMA', '2023-12-26', 'BUY', 445, NULL, NULL, NULL, NULL,
    'https://trendlyne.com/research-reports/post/SAREGAMA/1185/saregama-india-ltd/'),
  ('HDFC Securities', 'SAREGAMA', '2024-02-26', 'BUY', 447, '30x FY26E P/E (bull 32x = Rs 477)', 23.00, NULL,
    'Initiation. Music IP used 213bn times in FY23 across audio OTT + YouTube + radio + TV + social. Catalog growing 12%pa.',
    'https://www.hdfcsec.com/hsl.research.pdf/Stock%20Note%20on%20Saregama%20India%20Limited.pdf'),
  ('Sharekhan', 'SAREGAMA', '2024-08-09', 'BUY', 640, '40x FY27E EPS', 20.00, 16.00,
    'Music licensing + artist management = 68% of revenue FY24. Per-stream realization Rs 0.10 on free platforms. ~50% of paid subscription distributed to labels.',
    'https://www.sharekhan.com/MediaGalary/Equity/SaReGaMa-3R-Aug09_2024.pdf'),
  ('ICICI Direct', 'SAREGAMA', '2024-08-27', 'BUY', 600, NULL, NULL, NULL, NULL,
    'https://trendlyne.com/research-reports/post/SAREGAMA/1185/saregama-india-ltd/'),
  ('Emkay Global', 'SAREGAMA', '2024-11-06', 'BUY', 580, 'DCF (implied Sep26 PER 40x)', 25.00, NULL,
    'Strong headline numbers masked weakness in music licensing revenue. Near-term music licensing revenue cut ~1.5%.',
    'https://trendlyne.com/research-reports/post/SAREGAMA/1185/saregama-india-ltd/'),
  ('Sharekhan', 'SAREGAMA', '2025-03-17', 'BUY', 640, '40x FY27E EPS', 20.00, 16.00,
    'Wynk shutdown will accelerate paid-subscription migration. Remaining OTTA players expected to move paid over 4-5 quarters.',
    'https://www.sharekhan.com/MediaGalary/Equity/Saregama-Mar17_2025.pdf'),
  ('Nuvama', 'SAREGAMA', '2025-09-18', 'BUY', 630, NULL, 25.00, NULL,
    'Rs 700cr content investment over 2y, target 25-30% incremental market share, 26% IRR, 4-5y payback. Paid music subs at 8mn = ~1% penetration.',
    'https://www.businessupturn.com/finance/stock-market/brokerages/saregama-share-nuvama-maintains-buy-sees-28-upside-on-strong-content-investments-and-subscriber-growth/'),
  ('Nuvama', 'SAREGAMA', '2025-12-18', 'BUY', 585, NULL, 25.00, NULL,
    'Recession-proof. Bhansali Productions Rs 325cr CCPS deal (28-49.9% stake by Sep28). ~400bps savings vs market on music acquisition.',
    'https://www.business-standard.com/markets/news/nuvama-calls-saregama-a-recession-proof-pick-bets-on-strategic-tie-up-125121800133_1.html'),
  ('ICICI Direct', 'SAREGAMA', '2026-01-05', 'HOLD', 355, NULL, NULL, NULL,
    'Downgraded to Hold.',
    'https://www.theglobeandmail.com/investing/markets/markets-news/Tipranks/36923876/saregama-india-limited-saregama-was-downgraded-to-a-hold-rating-at-icici-securities/'),
  ('Nuvama', 'SAREGAMA', '2026-05-15', 'BUY', 525, '29x/25x FY27E/FY28E P/E', NULL, NULL,
    'Post Q4 FY26. FY27/28E revenue cut 6-9%, EPS raised 10-15%. Music licensing + artist mgmt +32% YoY. Video business (lossmaking) being shut down.',
    'https://www.businesstoday.in/markets/stocks/story/saregama-pricol-shares-jump-after-q4-earnings-what-sparked-the-upmove-531657-2026-05-15'),
  ('ICICI Direct', 'SAREGAMA', '2026-05-18', 'HOLD', 410, NULL, NULL, NULL,
    'Post Q4 FY26. Revenue +19.4% YoY to Rs 287.4 cr. Licensing Rs 184cr (+20.7%). Artist Management +125%. Carvaan -25%.',
    'https://trendlyne.com/research-reports/post/SAREGAMA/1185/saregama-india-ltd/')
ON CONFLICT (broker_name, company, asof) DO NOTHING;
