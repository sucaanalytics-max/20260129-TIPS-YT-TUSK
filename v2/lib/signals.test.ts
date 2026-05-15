/**
 * Unit tests for the IR signals layer.
 *
 * Run with: `npx tsx --test v2/lib/signals.test.ts` (zero install — tsx
 * resolves on demand via npx). Uses Node's built-in `node:test` so no test
 * runner dev-dep is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewMomentum,
  catalogFreshness,
  leadLagRead,
  relativeStrength,
  divergence,
  subscriberDrift,
  composeRead,
  type SignalsSnapshot,
  WARMUP_DAYS,
} from './signals';

// --- viewMomentum -----------------------------------------------------------

test('viewMomentum: warming when fewer than WARMUP_DAYS observations', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    daily_views: 1_000_000,
  }));
  const r = viewMomentum(rows);
  assert.equal(r.warming, true);
  assert.equal(r.value, null);
});

test('viewMomentum: stable series → near-zero z, flat direction', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    daily_views: 1_000_000,
  }));
  const r = viewMomentum(rows);
  assert.equal(r.warming, false);
  assert.ok(r.sigma == null || Math.abs(r.sigma) < 0.1, `expected |z| < 0.1, got ${r.sigma}`);
  assert.equal(r.direction, 'flat');
});

test('viewMomentum: monotone-rising series → positive z, up direction', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    daily_views: 1_000_000 + i * 10_000,
  }));
  const r = viewMomentum(rows);
  assert.equal(r.warming, false);
  assert.ok(r.sigma != null && r.sigma > 1, `expected z > 1, got ${r.sigma}`);
  assert.equal(r.direction, 'up');
});

// --- catalogFreshness -------------------------------------------------------

test('catalogFreshness: empty input → warming', () => {
  const r = catalogFreshness([]);
  assert.equal(r.warming, true);
});

test('catalogFreshness: all old catalog → low ratio, down direction', () => {
  const r = catalogFreshness(
    [
      { published_at: '2020-01-01', views_last_30d: 1_000_000 },
      { published_at: '2019-06-15', views_last_30d: 500_000 },
    ],
    new Date('2026-05-15'),
  );
  assert.equal(r.warming, false);
  assert.equal(r.value, 0);
  assert.equal(r.direction, 'down');
});

test('catalogFreshness: mostly-fresh catalog → high ratio, up direction', () => {
  const r = catalogFreshness(
    [
      { published_at: '2026-04-01', views_last_30d: 8_000_000 },
      { published_at: '2026-03-15', views_last_30d: 5_000_000 },
      { published_at: '2020-01-01', views_last_30d: 1_000_000 },
    ],
    new Date('2026-05-15'),
  );
  assert.equal(r.warming, false);
  assert.ok(r.value != null && r.value > 0.6);
  assert.equal(r.direction, 'up');
  assert.equal(r.significant, true);
});

// --- leadLagRead ------------------------------------------------------------

test('leadLagRead: empty → warming', () => {
  const r = leadLagRead([]);
  assert.equal(r.warming, true);
});

test('leadLagRead: picks strongest FDR-significant row', () => {
  const r = leadLagRead([
    { lag_days: -5, pearson_r: 0.6, p_value_fdr: 0.5, is_significant: false },
    { lag_days: 14, pearson_r: 0.42, p_value_fdr: 0.01, is_significant: true },
    { lag_days: 7, pearson_r: 0.3, p_value_fdr: 0.04, is_significant: true },
  ]);
  assert.equal(r.lagDays, 14);
  assert.equal(r.value, 0.42);
  assert.equal(r.significant, true);
  assert.equal(r.direction, 'up');
});

test('leadLagRead: when no FDR-significant rows, falls back to max |r| but flags not significant', () => {
  const r = leadLagRead([
    { lag_days: 1, pearson_r: 0.8, p_value_fdr: 0.3, is_significant: false },
    { lag_days: 5, pearson_r: -0.4, p_value_fdr: 0.4, is_significant: false },
  ]);
  assert.equal(r.lagDays, 1);
  assert.equal(r.significant, false);
});

// --- relativeStrength -------------------------------------------------------

test('relativeStrength: stock outperforming index → positive, up direction', () => {
  const stock = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    adjusted_close: 100 * Math.exp(0.002 * i), // +20% over 60 days
  }));
  const index = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    close: 100,
  }));
  const r = relativeStrength(stock, index, 30);
  assert.equal(r.warming, false);
  assert.ok(r.value != null && r.value > 0.02);
  assert.equal(r.direction, 'up');
});

test('relativeStrength: insufficient data → warming', () => {
  const stock = [{ date: '2026-05-01', adjusted_close: 100 }];
  const index = [{ date: '2026-05-01', close: 100 }];
  const r = relativeStrength(stock, index, 30);
  assert.equal(r.warming, true);
});

// --- divergence -------------------------------------------------------------

test('divergence: opposite-sign large z-scores → active', () => {
  const r = divergence(1.5, -1.2);
  assert.equal(r.active, true);
  assert.equal(r.significant, true);
});

test('divergence: same-sign z-scores → inactive', () => {
  const r = divergence(1.5, 1.2);
  assert.equal(r.active, false);
});

test('divergence: small magnitudes → inactive even if opposite sign', () => {
  const r = divergence(0.2, -0.3);
  assert.equal(r.active, false);
});

// --- subscriberDrift --------------------------------------------------------

test('subscriberDrift: warming when sparse data', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
    subscribers: 100_000,
  }));
  const r = subscriberDrift(rows);
  assert.equal(r.warming, true);
});

// --- composeRead ------------------------------------------------------------

function snap(overrides: Partial<SignalsSnapshot> = {}): SignalsSnapshot {
  return {
    company: 'TIPSMUSIC',
    asOf: '2026-05-15',
    daysAvailable: 365,
    viewMomentum: { value: 0, sigma: 0, direction: 'flat', significant: false, warming: false },
    catalogFreshness: { value: 0.5, direction: 'flat', significant: false, warming: false },
    leadLag: { value: 0, direction: 'flat', significant: false, warming: false, lagDays: 0 },
    relativeStrength: { value: 0, direction: 'flat', significant: false, warming: false },
    divergence: { value: 0, direction: 'flat', significant: false, warming: false, active: false },
    subscriberDrift: {
      value: 0,
      sigma: 0,
      direction: 'flat',
      significant: false,
      warming: false,
    },
    ...overrides,
  };
}

test('composeRead: all-positive snapshot → POSITIVE bias', () => {
  const s = snap({
    viewMomentum: { value: 1, sigma: 2, direction: 'up', significant: true, warming: false },
    catalogFreshness: { value: 0.75, direction: 'up', significant: true, warming: false },
    leadLag: { value: 0.42, direction: 'up', significant: true, warming: false, lagDays: 14 },
    relativeStrength: { value: 0.05, direction: 'up', significant: true, warming: false },
  });
  const r = composeRead(s);
  assert.equal(r.bias, 'POSITIVE');
  assert.ok(r.score >= 3, `expected score >= 3, got ${r.score}`);
});

test('composeRead: all-negative snapshot → NEGATIVE bias', () => {
  const s = snap({
    viewMomentum: { value: -1, sigma: -2, direction: 'down', significant: true, warming: false },
    catalogFreshness: { value: 0.2, direction: 'down', significant: false, warming: false },
    leadLag: { value: -0.42, direction: 'down', significant: true, warming: false, lagDays: 14 },
    relativeStrength: { value: -0.05, direction: 'down', significant: true, warming: false },
  });
  const r = composeRead(s);
  assert.equal(r.bias, 'NEGATIVE');
});

test('composeRead: flat snapshot → MIXED bias', () => {
  const r = composeRead(snap());
  assert.equal(r.bias, 'MIXED');
});

test('composeRead: non-FDR-significant lead-lag is ignored', () => {
  const s = snap({
    viewMomentum: { value: 1, sigma: 2, direction: 'up', significant: true, warming: false },
    catalogFreshness: { value: 0.75, direction: 'up', significant: true, warming: false },
    leadLag: { value: 0.8, direction: 'up', significant: false, warming: false, lagDays: 5 },
  });
  const r = composeRead(s);
  // viewMomentum(+2) + catalogFreshness(+2) = +4, lead-lag contributes 0
  assert.equal(r.bias, 'POSITIVE');
  assert.equal(r.score, 4);
});

test('composeRead: warming signals contribute 0 and show in sentence', () => {
  const s = snap({
    daysAvailable: 12,
    viewMomentum: { value: null, direction: 'flat', significant: false, warming: true },
    catalogFreshness: { value: null, direction: 'flat', significant: false, warming: true },
    leadLag: { value: null, direction: 'flat', significant: false, warming: true, lagDays: null },
  });
  const r = composeRead(s);
  assert.equal(r.bias, 'MIXED');
  assert.match(r.sentence, new RegExp(`Warming up . 12/${WARMUP_DAYS} days`));
});

test('composeRead: active divergence with view-up flips score positive', () => {
  const s = snap({
    viewMomentum: { value: 1, sigma: 1.0, direction: 'up', significant: false, warming: false },
    divergence: { value: 2.5, direction: 'up', significant: true, warming: false, active: true },
  });
  const r = composeRead(s);
  // viewMomentum(+2) + divergence(+2) = +4 → POSITIVE
  assert.equal(r.bias, 'POSITIVE');
});
