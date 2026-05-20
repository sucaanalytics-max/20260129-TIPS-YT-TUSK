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
  freshnessRatioAsOf,
  leadLagRead,
  relativeStrength,
  divergence,
  subscriberDrift,
  composeRead,
  peerRankMomentum,
  liveEventDensity,
  fitCatalogDecay,
  type SignalsSnapshot,
  type VideoFreshnessInput,
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

test('catalogFreshness: with baseline → company-relative z-score, not static threshold', () => {
  // Saregama-shaped: structurally low ratio (legacy catalog). Static thresholds
  // would mark this "down". With a baseline of similarly-low ratios it should
  // be flat / unsurprising.
  const videos: VideoFreshnessInput[] = [
    { published_at: '2020-01-01', views_last_30d: 9_000_000 },
    { published_at: '2026-04-01', views_last_30d: 1_000_000 }, // 10% fresh
  ];
  const baselineRatios = Array.from({ length: 30 }, () => 0.08 + Math.random() * 0.04); // ~0.08–0.12
  const r = catalogFreshness(videos, new Date('2026-05-15'), baselineRatios);
  // Current ratio = 0.10. Baseline mean ≈ 0.10. z ≈ 0 → flat.
  assert.equal(r.warming, false);
  assert.ok(r.value != null && r.value > 0.05 && r.value < 0.15);
  assert.equal(r.direction, 'flat');
});

test('catalogFreshness: with baseline → surge above own history flags up', () => {
  // Same Saregama-shaped label but current ratio is 0.40 vs baseline 0.10 mean.
  // Statically that'd be "flat" (between 0.3 and 0.6). With baseline it's
  // clearly a positive surprise.
  const videos: VideoFreshnessInput[] = [
    { published_at: '2020-01-01', views_last_30d: 6_000_000 },
    { published_at: '2026-04-01', views_last_30d: 4_000_000 }, // 40% fresh
  ];
  const baselineRatios = Array.from({ length: 30 }, () => 0.08 + Math.random() * 0.04);
  const r = catalogFreshness(videos, new Date('2026-05-15'), baselineRatios);
  assert.equal(r.direction, 'up');
  assert.equal(r.significant, true);
});

test('freshnessRatioAsOf: returns null on empty facts', () => {
  const r = freshnessRatioAsOf([], [], new Date('2026-05-15'));
  assert.equal(r, null);
});

test('freshnessRatioAsOf: computes ratio at a specific date', () => {
  const videos = [
    { video_id: 'old1', published_at: '2020-01-01' },
    { video_id: 'new1', published_at: '2026-03-15' },
  ];
  const facts = [
    { video_id: 'old1', daily_views: 100, date: '2026-05-14' },
    { video_id: 'new1', daily_views: 400, date: '2026-05-14' },
    { video_id: 'old1', daily_views: 100, date: '2026-05-13' },
  ];
  // As of 2026-05-15, window is (2026-04-15, 2026-05-15].
  // old1: 100 (5/14 inside) + 100 (5/13 inside) = 200, fresh=false
  // new1: 400 (5/14 inside) = 400, fresh=true (pub 2026-03-15 within 90d)
  // ratio = 400 / 600 ≈ 0.667
  const r = freshnessRatioAsOf(videos, facts, new Date('2026-05-15'));
  assert.ok(r != null && Math.abs(r - 400 / 600) < 1e-9);
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
    peerRankMomentum: {
      value: 0,
      sigma: 0,
      direction: 'flat',
      significant: false,
      warming: false,
    },
    liveEventDensity: {
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

// --- peerRankMomentum -------------------------------------------------------

test('peerRankMomentum: warming when fewer than 4 snapshots', () => {
  const r = peerRankMomentum([
    { asof: '2026-04-01', subs_rank: 30 },
    { asof: '2026-04-15', subs_rank: 28 },
    { asof: '2026-05-01', subs_rank: 25 },
  ]);
  assert.equal(r.warming, true);
});

test('peerRankMomentum: rank improving (lower number) → positive value, up direction', () => {
  // rank 30 → 25 over 30+ days = climbing by 5 positions
  const r = peerRankMomentum([
    { asof: '2026-03-01', subs_rank: 30 },
    { asof: '2026-03-15', subs_rank: 29 },
    { asof: '2026-04-01', subs_rank: 28 },
    { asof: '2026-04-15', subs_rank: 26 },
    { asof: '2026-05-01', subs_rank: 25 },
  ]);
  assert.equal(r.warming, false);
  assert.ok(r.value != null && r.value > 0, `expected positive value, got ${r.value}`);
  assert.equal(r.direction, 'up');
});

test('peerRankMomentum: rank deteriorating → negative value, down direction', () => {
  // rank 25 → 30 over 30+ days = falling 5 positions
  const r = peerRankMomentum([
    { asof: '2026-03-01', subs_rank: 25 },
    { asof: '2026-03-15', subs_rank: 26 },
    { asof: '2026-04-01', subs_rank: 27 },
    { asof: '2026-04-15', subs_rank: 29 },
    { asof: '2026-05-01', subs_rank: 30 },
  ]);
  assert.equal(r.warming, false);
  assert.ok(r.value != null && r.value < 0);
  assert.equal(r.direction, 'down');
});

test('peerRankMomentum: |delta| ≥ 3 is significant', () => {
  const r = peerRankMomentum([
    { asof: '2026-03-01', subs_rank: 30 },
    { asof: '2026-03-15', subs_rank: 28 },
    { asof: '2026-04-01', subs_rank: 27 },
    { asof: '2026-04-15', subs_rank: 26 },
    { asof: '2026-05-01', subs_rank: 25 },
  ]);
  assert.equal(r.significant, true);
});

// --- liveEventDensity -------------------------------------------------------

test('liveEventDensity: zero events → flat, warming', () => {
  const r = liveEventDensity([], new Date('2026-05-20'), 30);
  assert.equal(r.warming, true);
  assert.equal(r.value, 0);
});

test('liveEventDensity: cur > prior * 1.2 → up direction', () => {
  // prior 30d: 5 events, current 30d: 10 events
  const asOf = new Date('2026-05-20');
  const events = [
    // prior 30d window: 2026-03-21 → 2026-04-20
    { event_date: '2026-04-01' },
    { event_date: '2026-04-05' },
    { event_date: '2026-04-10' },
    { event_date: '2026-04-15' },
    { event_date: '2026-04-19' },
    // current 30d window: 2026-04-20 → 2026-05-20
    { event_date: '2026-04-21' },
    { event_date: '2026-04-25' },
    { event_date: '2026-04-30' },
    { event_date: '2026-05-03' },
    { event_date: '2026-05-06' },
    { event_date: '2026-05-09' },
    { event_date: '2026-05-12' },
    { event_date: '2026-05-15' },
    { event_date: '2026-05-17' },
    { event_date: '2026-05-19' },
  ];
  const r = liveEventDensity(events, asOf, 30);
  assert.equal(r.warming, false);
  assert.equal(r.value, 10);
  assert.equal(r.direction, 'up');
});

test('liveEventDensity: cur < prior * 0.8 → down direction', () => {
  const asOf = new Date('2026-05-20');
  const events = [
    // prior 30d: 10 events
    { event_date: '2026-04-01' },
    { event_date: '2026-04-02' },
    { event_date: '2026-04-03' },
    { event_date: '2026-04-04' },
    { event_date: '2026-04-05' },
    { event_date: '2026-04-06' },
    { event_date: '2026-04-07' },
    { event_date: '2026-04-08' },
    { event_date: '2026-04-09' },
    { event_date: '2026-04-10' },
    // current 30d: 5 events
    { event_date: '2026-05-01' },
    { event_date: '2026-05-05' },
    { event_date: '2026-05-09' },
    { event_date: '2026-05-13' },
    { event_date: '2026-05-17' },
  ];
  const r = liveEventDensity(events, asOf, 30);
  assert.equal(r.value, 5);
  assert.equal(r.direction, 'down');
});

// --- fitCatalogDecay --------------------------------------------------------

test('fitCatalogDecay: null when too few observations', () => {
  const obs = Array.from({ length: 20 }, (_, i) => ({
    video_age_days: i,
    daily_views: 1000 / (1 + i),
  }));
  assert.equal(fitCatalogDecay(obs), null);
});

test('fitCatalogDecay: recovers a known power-law decay (b=1)', () => {
  // Synthetic: views = 10000 * (1+t)^-1, no noise
  const obs = Array.from({ length: 100 }, (_, i) => ({
    video_age_days: i,
    daily_views: 10000 / (1 + i),
  }));
  const r = fitCatalogDecay(obs);
  assert.ok(r != null);
  assert.ok(Math.abs(r!.b - 1) < 0.01, `expected b≈1, got ${r!.b}`);
  assert.ok(Math.abs(r!.a - 10000) / 10000 < 0.01, `expected a≈10000, got ${r!.a}`);
  assert.ok(r!.r_squared > 0.99, `expected near-perfect R², got ${r!.r_squared}`);
});

test('fitCatalogDecay: filters non-positive views and negative ages', () => {
  const obs = [
    ...Array.from({ length: 50 }, (_, i) => ({
      video_age_days: i,
      daily_views: 1000 / (1 + i),
    })),
    { video_age_days: 10, daily_views: 0 },          // filtered
    { video_age_days: -5, daily_views: 100 },         // filtered
    { video_age_days: 5, daily_views: -10 },          // filtered
  ];
  const r = fitCatalogDecay(obs);
  assert.ok(r != null);
  assert.equal(r!.n_observations, 50);
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
