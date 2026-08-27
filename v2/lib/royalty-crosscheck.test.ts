/**
 * Tests for the royalty reconciliation guard.
 * Run: `npx tsx --test v2/lib/royalty-crosscheck.test.ts`
 *
 * The guard exists because the seeded India inputs are mutually inconsistent:
 * EY-FICCI's ~6tn stream count and the ₹0.10/stream min-guarantee rate are on
 * incompatible bases. These tests pin the real numbers so the failure cannot be
 * re-introduced silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoyaltyCrossCheck } from './demand';

const RECORDED_MUSIC = 59e9; // EY-FICCI 2025: ₹59bn
const AD_STREAMS = 6e12 - 164e9; // total - paid = 5.836tn

test('cross-check: the CURRENT seeded inputs fail — this is the live defect', () => {
  // TIPS at the placeholder 3% share, annual mid ≈ ₹1,766cr.
  const cc = computeRoyaltyCrossCheck({
    annual_mid_inr: 17_662_500_000,
    assumed_catalog_share: 0.03,
    recorded_music_revenue_inr: RECORDED_MUSIC,
    ad_streams: AD_STREAMS,
  });
  assert.equal(cc.passed, false);
  assert.equal(cc.failures.length, 2); // both the ceiling breach and the pool breach

  // A 3% catalog share caps the label at 3% of ₹59bn = ₹1.77bn.
  assert.equal(cc.ceiling_inr, 1_770_000_000);
  assert.ok(cc.ceiling_ratio != null && cc.ceiling_ratio > 9 && cc.ceiling_ratio < 11);

  // 30% of the ENTIRE national recorded-music market for one mid-cap.
  assert.ok(cc.implied_share_of_market != null);
  assert.ok(cc.implied_share_of_market > 0.29 && cc.implied_share_of_market < 0.31);

  // ₹0.10 x 5.836tn = ₹583.6bn against a ₹59bn market ≈ 9.9x.
  assert.ok(cc.free_pool_vs_market != null && cc.free_pool_vs_market > 9.8);
});

test('cross-check: a self-consistent estimate passes', () => {
  // 3% of the ₹10.3bn subscription pool ≈ ₹309m — comfortably inside the ceiling.
  const cc = computeRoyaltyCrossCheck({
    annual_mid_inr: 309_000_000,
    assumed_catalog_share: 0.03,
    recorded_music_revenue_inr: RECORDED_MUSIC,
    ad_streams: null,
  });
  assert.equal(cc.passed, true);
  assert.deepEqual(cc.failures, []);
  assert.ok(cc.ceiling_ratio != null && cc.ceiling_ratio < 0.2);
});

test('cross-check: exactly at the ceiling passes; well past it fails', () => {
  const at = computeRoyaltyCrossCheck({
    annual_mid_inr: 0.05 * RECORDED_MUSIC,
    assumed_catalog_share: 0.05,
    recorded_music_revenue_inr: RECORDED_MUSIC,
    ad_streams: null,
  });
  assert.equal(at.ceiling_ratio, 1);
  assert.equal(at.passed, true); // 1.0 is within the 1.2 tolerance

  const over = computeRoyaltyCrossCheck({
    annual_mid_inr: 0.05 * RECORDED_MUSIC * 2,
    assumed_catalog_share: 0.05,
    recorded_music_revenue_inr: RECORDED_MUSIC,
    ad_streams: null,
  });
  assert.equal(over.ceiling_ratio, 2);
  assert.equal(over.passed, false);
});

test('cross-check: no market figure → cannot reconcile, but must not false-pass a pool breach', () => {
  const cc = computeRoyaltyCrossCheck({
    annual_mid_inr: 17_662_500_000,
    assumed_catalog_share: 0.03,
    recorded_music_revenue_inr: null,
    ad_streams: AD_STREAMS,
  });
  assert.equal(cc.ceiling_inr, null);
  assert.equal(cc.ceiling_ratio, null);
  assert.equal(cc.implied_share_of_market, null);
  assert.equal(cc.free_pool_vs_market, null); // needs the market to compare against
  assert.equal(cc.passed, true); // nothing to check against — the UI shows "unreconciled"
});

test('cross-check: free-leg pool is computed from the per-stream rate', () => {
  const cc = computeRoyaltyCrossCheck({
    annual_mid_inr: 1,
    assumed_catalog_share: 0.03,
    recorded_music_revenue_inr: RECORDED_MUSIC,
    ad_streams: 1e12,
    free_per_stream_inr: 0.02, // a rate consistent with the market size
  });
  assert.equal(cc.free_pool_inr, 2e10);
  assert.ok(cc.free_pool_vs_market != null && cc.free_pool_vs_market < 1);
  assert.equal(cc.passed, true);
});
