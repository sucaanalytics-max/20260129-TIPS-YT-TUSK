import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pearson, alignedLogReturns, lagCorrelate, criticalR } from './correlation';

test('pearson: perfect positive and negative', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1);
});

test('pearson: uncorrelated is ~0; zero variance is null', () => {
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [1, 2, 2, 1])!) < 1e-9);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1], [1]), null);
});

test('pearson: known value to 3dp', () => {
  const r = pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])!;
  assert.equal(Math.round(r * 1000) / 1000, 0.8);
});

test('alignedLogReturns: first is null, rest are ln ratios', () => {
  const r = alignedLogReturns([100, 110]);
  assert.equal(r[0], null);
  assert.equal(Math.round(r[1]! * 10000) / 10000, Math.round(Math.log(1.1) * 10000) / 10000);
});

test('alignedLogReturns: non-positive prices yield null rather than NaN/-Infinity', () => {
  assert.deepEqual(alignedLogReturns([0, 100]).map((v) => v == null), [true, true]);
  assert.equal(alignedLogReturns([100, 0])[1], null);
});

test('lagCorrelate: aligns metric[t] with return[t+lag]', () => {
  // return leads metric by exactly one day -> lag +1 is the perfect match
  const metric = [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 },
                  { date: '2026-01-03', value: 3 }, { date: '2026-01-04', value: 4 }];
  const ret = [{ date: '2026-01-02', value: 1 }, { date: '2026-01-03', value: 2 },
               { date: '2026-01-04', value: 3 }, { date: '2026-01-05', value: 4 }];
  const out = lagCorrelate(metric, ret, [0, 1]);
  assert.equal(out.find((o) => o.lag === 1)!.r, 1);
  assert.ok(out.find((o) => o.lag === 1)!.n >= 3);
});

test('lagCorrelate: too few overlapping pairs yields a null r, never a fake one', () => {
  const out = lagCorrelate(
    [{ date: '2026-01-01', value: 1 }],
    [{ date: '2026-01-01', value: 1 }],
    [0],
  );
  assert.equal(out[0].r, null);
});

test('criticalR: matches the value verified for this dataset', () => {
  // n = 77 pairs, two-tailed p = 0.05 -> 0.2242, computed independently.
  assert.equal(Math.round(criticalR(77) * 10000) / 10000, 0.2242);
});

test('criticalR: tightens as n grows', () => {
  assert.ok(criticalR(500) < criticalR(50));
});
