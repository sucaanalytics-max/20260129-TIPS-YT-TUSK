-- Tighten the sanity ceiling on fct_reported_financials.value_inr.
--
-- 0027 shipped `value_inr < 1e13` under a comment claiming a "Rs 10,000 crore
-- ceiling". It is not: 1e13 rupees is 1,000,000 crore, so the guard sat 100x
-- looser than it was documented to be and caught essentially nothing.
--
-- 1e11 rupees = 10,000 crore, the figure 0027 meant. What that actually buys:
-- the filings quote LAKHS, so the realistic entry error is reaching for the
-- crore multiplier (1e7) where the lakh multiplier (1e5) was correct, inflating
-- by 100x. Saregama's FY27 Q1 is 18,460 lakhs; the slip yields 1.846e11, which
-- this constraint now rejects. Verified against the live table on application.
--
-- Be clear about what it does NOT catch: a 10x slip lands at 1.846e10 (1,846
-- crore), comfortably under the bar. No range check can catch that, because it
-- is a plausible revenue figure for a company of this size -- only the
-- source_url and confirmed_by columns can. The ceiling is a guard against
-- order-of-magnitude nonsense, not a substitute for checking the filing.
--
-- 0027 is left exactly as applied. Editing an already-applied migration would
-- make the file disagree with the database it claims to describe.

ALTER TABLE fct_reported_financials DROP CONSTRAINT IF EXISTS fct_reported_financials_value_chk;
ALTER TABLE fct_reported_financials ADD CONSTRAINT fct_reported_financials_value_chk
  CHECK (value_inr >= 0 AND value_inr < 1e11);
