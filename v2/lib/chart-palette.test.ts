/**
 * Run: npx tsx --test lib/chart-palette.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERIES, COMPANY_COLOR, STATUS, seriesColor } from './chart-palette';

test('seriesColor returns the fixed order', () => {
  assert.equal(seriesColor(0), '#0072B2');
  assert.equal(seriesColor(1), '#D55E00');
  assert.equal(seriesColor(2), '#009E73');
});

test('seriesColor refuses to cycle past the validated slots', () => {
  // Cycling would repaint a fourth series in the first series' colour, which
  // is the specific failure the validated three-slot ceiling exists to prevent.
  assert.throws(() => seriesColor(SERIES.length), RangeError);
  assert.throws(() => seriesColor(-1), RangeError);
});

test('every colour is a full six-digit hex', () => {
  // Three-digit hex and named colours break the validator's parsing, so the
  // module must never drift into them.
  for (const c of [...SERIES, ...Object.values(STATUS)]) {
    assert.match(c, /^#[0-9A-F]{6}$/, `${c} is not a six-digit uppercase hex`);
  }
});

test('the two companies never share a colour', () => {
  assert.notEqual(COMPANY_COLOR.TIPSMUSIC, COMPANY_COLOR.SAREGAMA);
  assert.ok(SERIES.includes(COMPANY_COLOR.TIPSMUSIC as (typeof SERIES)[number]));
  assert.ok(SERIES.includes(COMPANY_COLOR.SAREGAMA as (typeof SERIES)[number]));
});

test('no two categorical slots are the same colour', () => {
  assert.equal(new Set(SERIES).size, SERIES.length);
});
