/**
 * Unit and label handling for reported financials.
 *
 * Indian filings report in LAKHS and group digits as 1,14,430. Both are easy to
 * get wrong silently — a lakhs/rupees slip is a factor of 100,000 — so the
 * conversion lives here and everything downstream deals only in rupees.
 */

/** Which reported line each company's nowcast is scored against. */
export const TARGET_LINE_ITEM: Record<string, string> = {
  TIPSMUSIC: 'revenue_from_operations',   // single segment, so this IS the music line
  SAREGAMA: 'segment_revenue_music',      // group revenue also contains films, video, events
};

export const lakhsToRupees = (n: number): number => Math.round(n * 100_000);
export const rupeesToCrore = (n: number): number => n / 10_000_000;

export function formatCrore(n: number): string {
  return `₹${rupeesToCrore(n).toFixed(2)}cr`;
}

/**
 * Parse an amount as printed in a filing table. Returns null for anything that
 * is not a number — a dash, a label, an empty cell — so a bad parse surfaces as
 * missing rather than as zero.
 */
export function parseFilingAmount(text: string): number | null {
  const t = text.trim();
  if (t === '' || t === '-' || t === '—') return null;
  const negative = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/[()]/g, '').replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
