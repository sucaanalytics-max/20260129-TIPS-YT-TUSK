/**
 * The one source of chart colour. Nineteen components used to hardcode their
 * own hexes against a dark surface; this replaces all of them.
 *
 * Every value below was produced by the dataviz validator against the
 * Broadsheet surface (#FBF9F4), not chosen by eye:
 *
 *   validate_palette.js "#0072B2,#D55E00,#009E73" --mode light \
 *     --surface "#FBF9F4" --pairs all
 *   -> lightness PASS · chroma PASS · CVD PASS (worst all-pairs 11.0 deutan)
 *      normal-vision PASS (worst 18.7) · contrast PASS (all >= 3:1)
 */

/**
 * Categorical series, assigned in this fixed order and NEVER cycled.
 *
 * Three slots is the real ceiling on a light surface, not an oversight: under
 * deuteranopia and protanopia hue collapses onto a blue-yellow axis, so blue
 * and purple become the same colour (measured dE 0.3-4.5) and green and
 * vermillion nearly do. Every four-hue set tried failed the all-pairs CVD
 * check. Beyond three series, facet into small multiples or fold the tail into
 * `neutral` — do not invent a fourth hue.
 */
export const SERIES = ['#0072B2', '#D55E00', '#009E73'] as const;

/** Stable per-company colour, so a company keeps its hue on every surface. */
export const COMPANY_COLOR: Record<string, string> = {
  TIPSMUSIC: SERIES[0],
  SAREGAMA: SERIES[1],
};

/**
 * Reference and emphasis marks — an actual, a total, a benchmark. Ink is
 * deliberately NOT a categorical slot: it fails the categorical lightness and
 * chroma checks, and reads as structure rather than as one series among peers.
 * Use it for the line the others are compared against, drawn heavier.
 */
export const INK = '#16150F';
export const NEUTRAL = '#6E6A5C';

/** Chart furniture. Recessive by construction. */
export const GRID = '#E7E2D6';
export const AXIS = '#D6D1C4';
export const AXIS_TEXT = '#6E6A5C';
export const SURFACE = '#FBF9F4';

/**
 * Status. These FAIL the CVD check by nature — "good vs bad" is red vs green,
 * which is exactly the axis colour-blind readers lose. Contrast passes, so they
 * are legible; identity is carried by a glyph and a word beside the mark. Never
 * encode state in one of these colours alone.
 */
export const STATUS = {
  good: '#2E6B3E',
  warning: '#A8801A',
  serious: '#B85C1E',
  critical: '#8C2F27',
} as const;

export type StatusKey = keyof typeof STATUS;

/** Bands and fills sit under the marks, so they carry alpha, not a new hue. */
export const BAND_FILL = 'rgba(0, 114, 178, 0.12)';
export const BAND_FILL_WARN = 'rgba(140, 47, 39, 0.10)';

/**
 * Colour for series `i`. Throws past the third rather than silently cycling —
 * a repeated hue is a chart that lies about identity.
 */
export function seriesColor(i: number): string {
  if (i < 0 || i >= SERIES.length) {
    throw new RangeError(
      `seriesColor(${i}): only ${SERIES.length} categorical slots exist. ` +
        `Facet into small multiples or fold the tail into NEUTRAL.`,
    );
  }
  return SERIES[i];
}
