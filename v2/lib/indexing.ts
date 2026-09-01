/**
 * Rebasing for like-for-like comparison of series with different units.
 *
 * The handoff design drew "Reach vs price" with two y-axes — views on the left,
 * rupees on the right. Two independent scales can be slid until almost any
 * relationship appears, which is why this chart is rebased instead: every
 * series starts at 100 and shares one axis, so the vertical distance between
 * two lines is a real difference in relative growth rather than an artefact of
 * where the axes were pinned.
 */

/** Series rebased so its first usable value is 100. Nulls stay null. */
export function indexTo100(values: Array<number | null>): Array<number | null> {
  const base = values.find((v) => v != null && Number.isFinite(v) && v !== 0) ?? null;
  if (base == null) return values.map(() => null);
  return values.map((v) => (v == null || !Number.isFinite(v) ? null : (v / base) * 100));
}

/**
 * Pair two series on the indices where BOTH carry a value.
 *
 * Dropping unpaired points rather than zero-filling them matters: a market
 * holiday has no close, and treating it as a zero return would invent a crash
 * on every weekend.
 */
export function pairwise(
  xs: Array<number | null>,
  ys: Array<number | null>,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const a = xs[i];
    const b = ys[i];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    x.push(a);
    y.push(b);
  }
  return { x, y };
}
