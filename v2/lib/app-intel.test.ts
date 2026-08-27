/**
 * Unit tests for the pure parse/match helpers in app-intel.
 * Run: `npx tsx --test v2/lib/app-intel.test.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstallBucket, normaliseName, matchCatalogArtist } from './app-intel';

test('parseInstallBucket: parses Play bucket strings to a lower bound', () => {
  assert.deepEqual(parseInstallBucket('500,000,000+'), { bucket: '500,000,000+', min: 500_000_000 });
  assert.deepEqual(parseInstallBucket('1,000+'), { bucket: '1,000+', min: 1000 });
});

test('parseInstallBucket: null / empty / non-numeric', () => {
  assert.deepEqual(parseInstallBucket(null), { bucket: null, min: null });
  assert.deepEqual(parseInstallBucket(undefined), { bucket: null, min: null });
  assert.deepEqual(parseInstallBucket('N/A'), { bucket: 'N/A', min: null });
});

test('normaliseName: case, punctuation, diacritics', () => {
  assert.equal(normaliseName('A.R. Rahman'), 'a r rahman');
  assert.equal(normaliseName('Beyoncé'), 'beyonce');
  assert.equal(normaliseName('  Arijit   Singh  '), 'arijit singh');
});

test('matchCatalogArtist: substring match against catalog, handles multi-artist credits', () => {
  const catalog = ['Arijit Singh', 'Gur Sidhu', 'Lata Mangeshkar'];
  assert.equal(matchCatalogArtist('Cheema Y, Gur Sidhu', catalog), 'Gur Sidhu');
  assert.equal(matchCatalogArtist('Arijit Singh', catalog), 'Arijit Singh');
  assert.equal(matchCatalogArtist('Some Random Artist', catalog), null);
  assert.equal(matchCatalogArtist(null, catalog), null);
});
