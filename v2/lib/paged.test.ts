/**
 * Run: npx tsx --test lib/paged.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAll } from './paged';

/** A fake table that honours .range() the way PostgREST does. */
function fakeTable(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const makePage = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { makePage, calls };
}

test('pageAll: returns every row across pages, in order, with no gaps', async () => {
  const t = fakeTable(2500);
  const got = await pageAll(t.makePage, { label: 'test', pageSize: 1000 });
  assert.equal(got.length, 2500);
  assert.deepEqual(
    got.map((r) => r.id),
    Array.from({ length: 2500 }, (_, i) => i),
  );
});

test('pageAll: a short page ends the walk', async () => {
  const t = fakeTable(1500);
  await pageAll(t.makePage, { label: 'test', pageSize: 1000 });
  assert.equal(t.calls.length, 2, 'should stop as soon as a page comes back short');
});

test('pageAll: an exactly-full final page costs one extra empty request', async () => {
  // 2000 rows in pages of 1000 gives two full pages; only an empty third page
  // proves there is nothing after them. Stopping on the second would be a
  // silent truncation of exactly the kind this exists to prevent.
  const t = fakeTable(2000);
  const got = await pageAll(t.makePage, { label: 'test', pageSize: 1000 });
  assert.equal(got.length, 2000);
  assert.equal(t.calls.length, 3);
});

test('pageAll: an empty table returns an empty array, not a throw', async () => {
  const t = fakeTable(0);
  assert.deepEqual(await pageAll(t.makePage, { label: 'test' }), []);
});

test('pageAll: THROWS at the page cap rather than returning a partial result', async () => {
  // The whole point. Returning what it has would be indistinguishable from a
  // complete answer to every caller downstream.
  const t = fakeTable(10_000);
  await assert.rejects(
    () => pageAll(t.makePage, { label: 'big-read', pageSize: 100, maxPages: 3 }),
    /big-read: paged read exceeded 300 rows/,
  );
});

test('pageAll: surfaces the underlying error with its offset', async () => {
  const makePage = async (from: number) =>
    from === 0
      ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
      : { data: null, error: { message: 'connection reset' } };
  await assert.rejects(
    () => pageAll(makePage, { label: 'flaky', pageSize: 1000 }),
    /flaky: paged read failed at offset 1000 — connection reset/,
  );
});

test('pageAll: requests contiguous, non-overlapping ranges', async () => {
  const t = fakeTable(2500);
  await pageAll(t.makePage, { label: 'test', pageSize: 1000 });
  assert.deepEqual(t.calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});
