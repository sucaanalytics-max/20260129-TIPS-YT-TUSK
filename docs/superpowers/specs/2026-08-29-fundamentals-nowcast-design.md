# Catalogue fundamentals — a scored revenue nowcast

**Status:** design, approved 2026-08-29 · supersedes the IR-cockpit framing
**Scope:** replaces the product's organising principle. Existing pages survive as evidence.

---

## 1. Why this replaces what exists

The dashboard was built to connect YouTube attention to the share price. Tested properly, that
connection is not present in our data: across three metrics × two companies × fifteen lags,
**3 of 90 tests clear the 5% line where chance alone predicts 4.5**. Nothing survives
Benjamini–Hochberg correction, and all three hits are Tips releases with a sign flip across
adjacent, autocorrelated lags. Critical |r| at n≈77 is 0.2242.

Meanwhile the product presented four different classes of number at equal visual weight:

| Class | Example | Reality |
|---|---|---|
| Measured | daily views, subscribers, releases | solid, 3.5 years |
| Modelled, roughly calibrated | YouTube revenue band | ₹203–302cr/yr vs Tips actual ₹375.5cr — plausible |
| Modelled, badly wrong | implied audio-DSP royalty | sized Tips at ₹1,766cr/yr — **4.7× the company's entire revenue** |
| Unsupported | attention → price | null result |

A grade-D badge on a card is not adequate protection against that. **The problem was epistemic,
not visual**, and no rearrangement of the same undifferentiated material fixes it.

## 2. What the product becomes

A **catalogue fundamentals tracker** whose headline is a revenue nowcast that gets **scored
against what actually prints**. Accuracy is earned by track record, not declared by a badge.

### The placement rule

- **Level 0** — a figure reaches the front page only if it can be scored against something that
  actually gets reported.
- **Level 1** — it feeds a Level 0 number and its assumptions are visible and editable.
- **Level 2** — it is measured but does not yet feed anything.
- **Nowhere** — it cannot be checked at all.

### Cut outright

`Implied audio-DSP royalty` (inputs mutually inconsistent — ₹0.10/stream × 5.836tn implies a
royalty pool 9.9× India's entire recorded-music market); `Event horizon` (no forward-dated rows
exist anywhere, so it renders empty in production today); the correlation page (demoted to a
one-line footnote); the `READ` verdict (replaced by a number that can be wrong).

## 3. The nowcast target — different per company

Verified against the Q1 FY27 filings, not assumed.

**Tips Music** — a single-segment company. Target is **total revenue from operations**.
Q1 FY27 ₹106.51cr (10,651.22 lakhs), +20.9% YoY, FY26 ₹375.51cr.

**Saregama** — four operating segments (Music, Artist Management, Video, Events), disclosed in a
dedicated "Consolidated Segment wise Revenue, Results, Assets and Liabilities" table. Target is
the **Music segment only**. Q1 FY27 ₹184.6cr (18,460 lakhs), +28.8% YoY, FY26 ₹683.52cr — 69.4%
of group revenue. Segment *profit* is also disclosed (₹94.9cr in Q1), so margin nowcasting is
possible later.

**Never compare the two at level.** Tips' ₹106.51cr is a whole company; Saregama's ₹184.6cr is
one segment of one. Growth rates are comparable; absolute figures are not. The UI states this.

## 4. Architecture

### New tables

`fct_reported_financials` — one row per (company, fiscal period, line item). Stores the actual:
value in lakhs, the source filing URL, extraction method, and whether a human confirmed it.
Backfilled from the PDFs already linked in `dim_earnings_event` (83 events, Tips to 2016,
Saregama to 2019).

`fct_revenue_nowcast` — one row per (company, fiscal quarter, as-of date). The estimate is a
**time series, not a single value**: you see it move as the quarter fills in, which is most of
its diagnostic worth. Stores the band, the driver contributions that produced it, and the
assumption set used.

### New pure libraries (unit-tested, per repo convention)

`lib/nowcast.ts` — drivers + assumptions → estimate band. No I/O.
`lib/scoring.ts` — estimate vs actual → absolute error, percentage error, band-contained boolean.
`lib/fiscal.ts` — Indian FY quarter arithmetic (FY runs Apr–Mar; Q1 FY27 = Apr–Jun 2026).

### Extraction

Face-of-P&L for Tips is one number in a stable layout. Saregama needs the segment table, which is
its own page with the same four-column shape — structurally no harder. Roughly two filings per
quarter ongoing, ~40 historical to backfill.

**Extraction is assistive, not autonomous.** Every extracted figure lands with
`confirmed_by IS NULL` and renders struck-through with its source PDF one click away; it is
excluded from scoring until someone confirms it. A misparsed revenue line silently poisons the
whole track record, which is the one thing this design cannot afford.

## 5. Surfaces

**Level 0 — `/` Nowcast.** Two estimates side by side with their bands, quarter-elapsed, movement
since last week, and the **track record directly beneath**. On day one that panel reads
*"0 quarters scored"* in the most prominent position on the page. That is deliberate: a number
with no record should look like one.

**Level 1 — `/drivers`.** Reach → monetisation → revenue, left to right. Measured inputs on the
left, assumptions as controls in the middle, a contribution waterfall on the right. A sensitivity
panel ranks assumptions by how much they move the answer. The catalogue-share constant that made
the royalty model 10× too big was buried in a file; here every assumption is a control with the
user's name on it.

**Level 2 — `/evidence`.** Today's dashboard, consolidated. The `/analysis` and `/explore` pages
already built on `deploy/dashboard-rebuild` become sections of it rather than separate
destinations; `/market`, `/channels`, `/growth` and `/ops` follow. Nothing here is rewritten —
it is re-parented and restyled. How you check a driver, not what you open the product for.

## 6. Visual language — Broadsheet

Warm paper `#FBF9F4`, ink `#16150F`, rules and double-rules instead of cards, Source Serif 4 for
display and figures, IBM Plex Sans for labels and data, a single oxblood accent `#8C2F27` reserved
for warnings and out-of-control marks, amber `#C9A227` reserved for *assumptions the user owns*.

Deliberately abandons the current dark-slate / Inter / rounded-card system. The reference is a
research note you would publish, not a monitoring console — which matches what the product now
claims to be.

## 7. Known limits, stated in the product

- **Measurement regime break at 2026-02-16.** Before it, one synthetic legacy aggregate row per
  day (1.0 channels); after, real per-channel data (15 Tips / 23 Saregama). Totals either side are
  broadly comparable; a channel slicer has nothing to bite on before the break and reads `n/a`.
- **Releases cannot be compared across the break at all.** The legacy aggregate never recorded
  video counts, so pre-2026 reads `n/a`, not 0 — a harder limit than views. 2026-Q1's 3,812
  releases is the first per-channel reading, not a release burst.
- **Subscriber counts are quantised to 1,000 per channel.** σ is 2.3× the mean; daily figures are
  noise, moving averages are the signal.
- **YouTube freezes cumulative view counts** on ~4.7% of channel-days. Repaired days are flagged
  and excludable.
- **No forward-looking data exists** — no upcoming releases, no scheduled events.
- **No competitor labels are tracked.** The 33 non-owned channels are artist Topic channels for
  catalogue attribution, not rival labels.

## 8. Testing

Pure libraries are unit-tested as with `control-chart.ts`, `period-compare.ts` and
`correlation.ts` (154 tests currently passing). Extraction gets golden-file tests against the
filings already downloaded. The scoring loop is itself the integration test: a nowcast whose
error is never computed is a bug.

## 9. Sequence

1. `fct_reported_financials` + extraction + human confirmation UI. Backfill Tips first — it is
   the simpler parse and the purer target.
2. `lib/fiscal.ts`, `lib/nowcast.ts`, `lib/scoring.ts` with tests.
3. `fct_revenue_nowcast` + the daily job that appends today's estimate.
4. Level 0 surface in Broadsheet.
5. Level 1 driver tree.
6. Restyle Level 2 into Broadsheet.

Nothing after step 1 is meaningful without actuals to score against, so step 1 is the gate.

**This is two implementation plans, not one.** Steps 1–3 are the data and model spine and can be
built and verified with no UI at all. Steps 4–6 are the surfaces and depend entirely on the spine
existing. Attempting both as a single plan would mean building screens against a nowcast that has
never produced a number.

## 10. What would falsify this design

If after four scored quarters the nowcast's error is no better than a naive
"last quarter × seasonal factor" baseline, the model adds nothing and should be replaced by that
baseline. The track record makes that judgement automatic rather than a matter of taste — which
is the point.
