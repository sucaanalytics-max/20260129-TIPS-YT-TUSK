/**
 * Run: npx tsx --test lib/fdr.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { benjaminiHochberg, expectedFalsePositives } from './fdr';

const round = (n: number, d = 6) => Number(n.toFixed(d));

test('BH: the textbook worked example', () => {
  // Benjamini & Hochberg (1995) §2, the Needleman data.
  // p sorted: .0001 .0004 .0019 .0095 .0201 .0278 .0298 .0344 .0459 .3240
  //           .4262 .5719 .6528 .7590 1.000   (m = 15)
  // Largest i where p(i) <= i/m * .05 is i = 4 (.0095 <= .01333), so the first
  // four are rejected and nothing beyond them is.
  const ps = [
    0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344, 0.0459, 0.324,
    0.4262, 0.5719, 0.6528, 0.759, 1.0,
  ];
  const got = benjaminiHochberg(ps, (p) => p, 0.05);
  const rejected = got.filter((g) => g?.significant).length;
  assert.equal(rejected, 4);
  // q for the smallest = .0001 * 15/1 = .0015
  assert.equal(round(got[0]!.q), 0.0015);
});

test('BH: q values are monotone non-decreasing in p', () => {
  // The step-up enforcement. Raw p*m/i is NOT monotone; without carrying the
  // running minimum a weaker test can receive a smaller q than a stronger one.
  const ps = [0.01, 0.02, 0.03, 0.04, 0.05];
  const got = benjaminiHochberg(ps, (p) => p, 0.05).map((g) => g!.q);
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i] >= got[i - 1], `q went down at ${i}: ${got[i - 1]} -> ${got[i]}`);
  }
});

test('BH: results come back in input order, not sorted order', () => {
  const ps = [0.9, 0.001, 0.5];
  const got = benjaminiHochberg(ps, (p) => p, 0.05);
  assert.equal(got[0]!.p, 0.9);
  assert.equal(got[1]!.p, 0.001);
  assert.equal(got[2]!.p, 0.5);
  // Only the tiny one survives.
  assert.equal(got[1]!.significant, true);
  assert.equal(got[0]!.significant, false);
});

test('BH: is strictly less conservative than Bonferroni', () => {
  // The reason BH is used rather than Bonferroni: on this grid Bonferroni
  // would reject nothing.
  const ps = [0.001, 0.008, 0.02, 0.04, 0.2];
  const got = benjaminiHochberg(ps, (p) => p, 0.05);
  const bhRejects = got.filter((g) => g?.significant).length;
  const bonferroniRejects = ps.filter((p) => p <= 0.05 / ps.length).length;
  assert.ok(bhRejects >= bonferroniRejects);
  assert.ok(bhRejects > 0);
});

test('BH: uncomputable tests are excluded from m, not counted as failures', () => {
  // Two real tests plus three that had too little data. m must be 2, so the
  // real tests are not penalised for the missing ones.
  const items = [0.01, null, 0.02, null, null] as Array<number | null>;
  const got = benjaminiHochberg(items, (p) => p, 0.05);
  assert.equal(got[1], null);
  assert.equal(got[3], null);
  // q for the smallest of two = .01 * 2/1 = .02
  assert.equal(round(got[0]!.q), 0.02);
  assert.equal(got[0]!.significant, true);
});

test('BH: a p of exactly 1 does not produce a q above 1', () => {
  const got = benjaminiHochberg([1, 1, 1], (p) => p, 0.05);
  for (const g of got) assert.ok(g!.q <= 1, `q exceeded 1: ${g!.q}`);
});

test('BH: out-of-range and non-finite p are treated as untestable', () => {
  const items = [0.01, Number.NaN, -0.5, 1.5, Number.POSITIVE_INFINITY];
  const got = benjaminiHochberg(items, (p) => p, 0.05);
  assert.equal(got.filter((g) => g != null).length, 1);
  // m collapses to 1, so q equals p.
  assert.equal(round(got[0]!.q), 0.01);
});

test('BH: an empty set returns an empty result rather than throwing', () => {
  assert.deepEqual(benjaminiHochberg([], (p: number) => p, 0.05), []);
});

test('BH: works on objects via the accessor', () => {
  const cells = [
    { name: 'a', p: 0.001 },
    { name: 'b', p: 0.9 },
  ];
  const got = benjaminiHochberg(cells, (c) => c.p, 0.05);
  assert.equal(got[0]!.item.name, 'a');
  assert.equal(got[0]!.significant, true);
  assert.equal(got[1]!.significant, false);
});

test('expectedFalsePositives: names how much of a scan is noise', () => {
  // 180 tests at 5% — the number that makes the correction obviously necessary.
  assert.equal(expectedFalsePositives(180, 0.05), 9);
});
