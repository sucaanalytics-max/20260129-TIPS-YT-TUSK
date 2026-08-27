/**
 * Unit tests for UGC reach aggregation — the dedup + first-party-exclusion +
 * exact-count-preference logic that fixes the double-count traps found in the
 * raw getUGCReach sum (which summed every (source,ugc) row, undeduped, and
 * never excluded first-party shorts).
 *
 * Run with: `npm test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUgcReach, type UgcVideoMeta } from './ugc-aggregate';

const meta = (m: Record<string, UgcVideoMeta>) => new Map(Object.entries(m));

test('aggregateUgcReach: dedups a ugc_video_id appearing under multiple anchors (max approx)', () => {
  const r = aggregateUgcReach(
    [
      { ugc_video_id: 'A', view_count: 1000 }, // same short under anchor 1
      { ugc_video_id: 'A', view_count: 1200 }, // ...and anchor 2 → count ONCE (max)
      { ugc_video_id: 'B', view_count: 500 },
    ],
    meta({}), // no exact metadata → approx fallback
    new Set(),
  );
  assert.equal(r.shorts_count, 2);
  assert.equal(r.cumulative_views, 1200 + 500); // A counted once at its max approx
  assert.equal(r.approx_count, 2);
  assert.equal(r.exact_count, 0);
});

test('aggregateUgcReach: prefers exact latest_view_count over approx', () => {
  const r = aggregateUgcReach(
    [{ ugc_video_id: 'A', view_count: 1000 }],
    meta({ A: { channel_id: 'creatorX', latest_view_count: 1337 } }),
    new Set(),
  );
  assert.equal(r.cumulative_views, 1337);
  assert.equal(r.exact_count, 1);
  assert.equal(r.approx_count, 0);
});

test('aggregateUgcReach: excludes first-party shorts (posted by our own channels)', () => {
  const r = aggregateUgcReach(
    [
      { ugc_video_id: 'A', view_count: 1000 }, // third-party → kept
      { ugc_video_id: 'OWN', view_count: 9_999_999 }, // on our owned channel → dropped
    ],
    meta({
      A: { channel_id: 'creatorX', latest_view_count: null },
      OWN: { channel_id: 'ourChan1', latest_view_count: 9_999_999 },
    }),
    new Set(['ourChan1']),
  );
  assert.equal(r.shorts_count, 1);
  assert.equal(r.excluded_firstparty, 1);
  assert.equal(r.cumulative_views, 1000); // the 9.99M first-party short is excluded
});

test('aggregateUgcReach: empty input → all zeros', () => {
  const r = aggregateUgcReach([], meta({}), new Set());
  assert.deepEqual(r, {
    cumulative_views: 0,
    shorts_count: 0,
    excluded_firstparty: 0,
    exact_count: 0,
    approx_count: 0,
  });
});

test('aggregateUgcReach: null approx with no exact contributes 0 views but still counts the short', () => {
  const r = aggregateUgcReach(
    [{ ugc_video_id: 'A', view_count: null }],
    meta({ A: { channel_id: 'creatorX', latest_view_count: null } }),
    new Set(),
  );
  assert.equal(r.shorts_count, 1);
  assert.equal(r.cumulative_views, 0);
  assert.equal(r.approx_count, 1);
});
