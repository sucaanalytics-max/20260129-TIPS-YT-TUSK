import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEstimate, summariseTrackRecord, type ScoredQuarter } from './scoring';

const band = { low: 90, mid: 100, high: 110 };

test('scoreEstimate: error is measured against the band mid, as a share of the ACTUAL', () => {
  // Percentage error is conventionally relative to what actually happened (MAPE),
  // which is what a track record reports: 20 off a 120 print is 16.7%, not 20%.
  const s = scoreEstimate(band, 120);
  assert.equal(s.absError, 20);
  assert.equal(Number(s.pctError!.toFixed(4)), 16.6667);
  assert.equal(s.withinBand, false);
  assert.deepEqual(scoreEstimate(band, 100), { absError: 0, pctError: 0, withinBand: true });
});

test('scoreEstimate: within-band is inclusive of the edges', () => {
  assert.equal(scoreEstimate(band, 90).withinBand, true);
  assert.equal(scoreEstimate(band, 110).withinBand, true);
  assert.equal(scoreEstimate(band, 89.99).withinBand, false);
});

test('scoreEstimate: an actual of zero yields null pctError, not Infinity', () => {
  const s = scoreEstimate(band, 0);
  assert.equal(s.absError, 100);
  assert.equal(s.pctError, null);
});

test('summariseTrackRecord: empty history is reported as unproven, not as perfect', () => {
  const t = summariseTrackRecord([]);
  assert.equal(t.n, 0);
  assert.equal(t.hitRate, null);
  assert.equal(t.medianAbsPctError, null);
  assert.equal(t.worst, null);
});

test('summariseTrackRecord: hit rate and median absolute percentage error', () => {
  const rows: ScoredQuarter[] = [
    { fiscalLabel: 'FY26 Q1', estimate: band, actual: 100, absError: 0,  pctError: 0,   withinBand: true },
    { fiscalLabel: 'FY26 Q2', estimate: band, actual: 120, absError: 20, pctError: 20,  withinBand: false },
    { fiscalLabel: 'FY26 Q3', estimate: band, actual: 105, absError: 5,  pctError: 5,   withinBand: true },
  ];
  const t = summariseTrackRecord(rows);
  assert.equal(t.n, 3);
  assert.equal(Number(t.hitRate!.toFixed(4)), 0.6667);
  assert.equal(t.medianAbsPctError, 5);
  assert.equal(t.worst!.fiscalLabel, 'FY26 Q2');
});

test('summariseTrackRecord: median of an even count averages the middle two', () => {
  const mk = (label: string, pct: number): ScoredQuarter => ({
    fiscalLabel: label, estimate: band, actual: 100, absError: 0, pctError: pct, withinBand: true,
  });
  const t = summariseTrackRecord([mk('a', 2), mk('b', 4), mk('c', 6), mk('d', 8)]);
  assert.equal(t.medianAbsPctError, 5);
});
