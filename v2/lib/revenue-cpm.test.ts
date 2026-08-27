/**
 * Unit tests for the revenue-from-views / royalty estimators.
 *
 * Run with: `npx tsx --test v2/lib/revenue-cpm.test.ts` (zero install).
 * Uses Node's built-in `node:test` so no test-runner dev-dep is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateUgcRevenue,
  estimateStreamingRoyalty,
  gradeConfidence,
  capGrade,
} from './revenue-cpm';

// --- capGrade ----------------------------------------------------------------

test('capGrade: never reports better than the cap', () => {
  assert.equal(capGrade('A', 'D'), 'D');
  assert.equal(capGrade('B', 'D'), 'D');
  assert.equal(capGrade('D', 'D'), 'D');
  assert.equal(capGrade('F', 'D'), 'F'); // worse than cap is preserved
});

// --- estimateUgcRevenue: A2 language weighting -------------------------------

test('estimateUgcRevenue: Hindi-baseline when no language mix', () => {
  const r = estimateUgcRevenue({ attributed_views_7d: 7_000_000 });
  // 1M/day proxy × ₹15/1k × 45% share = ₹6,750/day mid
  assert.equal(r.daily.mid_inr, Math.round((1_000_000 / 1000) * 15 * 0.45));
  assert.ok(r.confidence_factors.notes.some((n) => n.includes('Hindi baseline')));
});

test('estimateUgcRevenue: Punjabi/English mix lifts the band above baseline', () => {
  const views = 7_000_000;
  const baseline = estimateUgcRevenue({ attributed_views_7d: views });
  const diaspora = estimateUgcRevenue({
    attributed_views_7d: views,
    languageMix: [
      { language: 'pa', weight: 0.5 }, // 1.3×
      { language: 'en', weight: 0.5 }, // 1.7×  → blended 1.5×
    ],
  });
  assert.ok(
    diaspora.weekly.mid_inr > baseline.weekly.mid_inr,
    `expected diaspora band > baseline (${diaspora.weekly.mid_inr} vs ${baseline.weekly.mid_inr})`,
  );
  // Blended multiplier should be ~1.5×
  assert.equal(diaspora.weekly.mid_inr, Math.round(baseline.weekly.mid_inr * 1.5));
  assert.ok(diaspora.confidence_factors.notes.some((n) => n.includes('Language-weighted')));
});

test('estimateUgcRevenue: views_are_exact flips the accuracy note only', () => {
  const approx = estimateUgcRevenue({ attributed_views_7d: 7_000_000 });
  const exact = estimateUgcRevenue({ attributed_views_7d: 7_000_000, views_are_exact: true });
  assert.ok(approx.confidence_factors.notes.some((n) => n.includes('approximate')));
  assert.ok(exact.confidence_factors.notes.some((n) => n.includes('exact')));
  // Maths unchanged
  assert.equal(approx.weekly.mid_inr, exact.weekly.mid_inr);
});

// --- estimateStreamingRoyalty: C1 directional sizing -------------------------

test('estimateStreamingRoyalty: band ordering low < mid < high', () => {
  const r = estimateStreamingRoyalty({
    india_subscription_revenue_inr_annual: 10_300_000_000, // ₹10.3bn (EY-FICCI 2025)
    india_ad_streams_annual: 5_000_000_000_000, // ~5tn free streams
    label_catalog_share: 0.05,
  });
  assert.ok(r.quarterly.low_inr < r.quarterly.mid_inr);
  assert.ok(r.quarterly.mid_inr < r.quarterly.high_inr);
});

test('estimateStreamingRoyalty: zero catalog share → zero royalty', () => {
  const r = estimateStreamingRoyalty({
    india_subscription_revenue_inr_annual: 10_300_000_000,
    india_ad_streams_annual: 5_000_000_000_000,
    label_catalog_share: 0,
  });
  assert.equal(r.quarterly.mid_inr, 0);
  assert.equal(r.weekly.mid_inr, 0);
  assert.equal(r.daily.mid_inr, 0);
});

test('estimateStreamingRoyalty: scales linearly with catalog share', () => {
  const base = { india_subscription_revenue_inr_annual: 10_300_000_000, india_ad_streams_annual: 0 };
  const a = estimateStreamingRoyalty({ ...base, label_catalog_share: 0.02 });
  const b = estimateStreamingRoyalty({ ...base, label_catalog_share: 0.04 });
  // ad streams = 0 isolates the paid leg, which is linear in share
  assert.equal(b.quarterly.mid_inr, a.quarterly.mid_inr * 2);
});

test('estimateStreamingRoyalty: paid leg = subscription rev × 50% × share (mid)', () => {
  const r = estimateStreamingRoyalty({
    india_subscription_revenue_inr_annual: 10_300_000_000,
    india_ad_streams_annual: 0,
    label_catalog_share: 0.05,
  });
  const expectedAnnualMid = 10_300_000_000 * 0.5 * 0.05; // ₹257.5M
  assert.equal(r.quarterly.mid_inr, Math.round(expectedAnnualMid / 4));
});

test('estimateStreamingRoyalty: grade is capped at D even with long history', () => {
  const r = estimateStreamingRoyalty({
    india_subscription_revenue_inr_annual: 10_300_000_000,
    india_ad_streams_annual: 0,
    label_catalog_share: 0.05,
    data_days: 400, // would otherwise grade A/B
    sample_size: 100,
    backtest_calibration: 1.0,
  });
  assert.equal(r.confidence_grade, 'D');
  assert.ok(r.confidence_factors.notes.some((n) => n.includes('DIRECTIONAL SIZING ONLY')));
});

// sanity: gradeConfidence still behaves (regression guard)
test('gradeConfidence: cold start is F, <7d is D', () => {
  assert.equal(gradeConfidence({ data_days: 0, sample_size: 0, catalog_match_pct: 0, backtest_calibration: null, notes: [] }), 'F');
  assert.equal(gradeConfidence({ data_days: 3, sample_size: 5, catalog_match_pct: 0, backtest_calibration: null, notes: [] }), 'D');
});
