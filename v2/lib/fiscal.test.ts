import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiscalQuarterOf, quarterProgress, previousQuarter, sameQuarterLastYear } from './fiscal';

test('fiscalQuarterOf: Indian FY starts in April; label is the ending year', () => {
  assert.deepEqual(fiscalQuarterOf('2026-08-29'), {
    fy: 27, q: 2, label: 'FY27 Q2', start: '2026-07-01', end: '2026-09-30',
  });
  assert.deepEqual(fiscalQuarterOf('2026-04-01'), {
    fy: 27, q: 1, label: 'FY27 Q1', start: '2026-04-01', end: '2026-06-30',
  });
});

test('fiscalQuarterOf: Jan-Mar belongs to Q4 of the FY that ends that year', () => {
  assert.deepEqual(fiscalQuarterOf('2026-03-31'), {
    fy: 26, q: 4, label: 'FY26 Q4', start: '2026-01-01', end: '2026-03-31',
  });
  assert.equal(fiscalQuarterOf('2026-01-01').label, 'FY26 Q4');
});

test('quarterProgress: 29 Aug 2026 is 60 of 92 days into FY27 Q2', () => {
  assert.equal(Number(quarterProgress('2026-08-29').toFixed(4)), 0.6522);
});

test('quarterProgress: first and last day of a quarter', () => {
  assert.equal(Number(quarterProgress('2026-07-01').toFixed(4)), Number((1 / 92).toFixed(4)));
  assert.equal(quarterProgress('2026-09-30'), 1);
});

test('previousQuarter: steps back, rolling the FY at Q1', () => {
  assert.equal(previousQuarter(fiscalQuarterOf('2026-08-29')).label, 'FY27 Q1');
  assert.equal(previousQuarter(fiscalQuarterOf('2026-04-15')).label, 'FY26 Q4');
});

test('sameQuarterLastYear: same quarter number, one FY back', () => {
  const q = sameQuarterLastYear(fiscalQuarterOf('2026-08-29'));
  assert.equal(q.label, 'FY26 Q2');
  assert.equal(q.start, '2025-07-01');
  assert.equal(q.end, '2025-09-30');
});
