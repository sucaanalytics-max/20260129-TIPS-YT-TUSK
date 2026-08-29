import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lakhsToRupees, rupeesToCrore, formatCrore, parseFilingAmount, TARGET_LINE_ITEM,
} from './financials';

test('lakhsToRupees: filings report lakhs; we store rupees', () => {
  assert.equal(lakhsToRupees(10651.22), 1065122000);
  assert.equal(lakhsToRupees(18460), 1846000000);
});

test('rupeesToCrore and formatCrore', () => {
  assert.equal(rupeesToCrore(1065122000), 106.5122);
  assert.equal(formatCrore(1065122000), '₹106.51cr');
  assert.equal(formatCrore(0), '₹0.00cr');
});

test('parseFilingAmount: strips separators, handles bracketed negatives', () => {
  assert.equal(parseFilingAmount('10,651.22'), 10651.22);
  assert.equal(parseFilingAmount('1,14,430'), 114430);       // Indian grouping
  assert.equal(parseFilingAmount('(434)'), -434);            // accounting negative
  assert.equal(parseFilingAmount(' 18,460 '), 18460);
});

test('parseFilingAmount: refuses anything that is not a number', () => {
  assert.equal(parseFilingAmount('-'), null);
  assert.equal(parseFilingAmount(''), null);
  assert.equal(parseFilingAmount('Revenue from operations'), null);
});

test('TARGET_LINE_ITEM: the two companies are nowcast on different lines', () => {
  assert.equal(TARGET_LINE_ITEM.TIPSMUSIC, 'revenue_from_operations');
  assert.equal(TARGET_LINE_ITEM.SAREGAMA, 'segment_revenue_music');
});
