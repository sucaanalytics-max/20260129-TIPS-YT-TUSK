import type { RevenueEstimate } from '@/lib/revenue-cpm';

/**
 * Confidence indicator for a modelled revenue estimate. Surfaces the
 * letter grade (A-F) plus the factors driving it on hover. Designed to
 * sit next to revenue-band lines so the reader sees the uncertainty
 * scaffolding at a glance instead of treating the band as gospel.
 *
 * Color coding intentionally subdued — we don't want the grade to
 * dominate; we want it to anchor expectations.
 */
export function ConfidenceBadge({ estimate }: { estimate: RevenueEstimate }) {
  const grade = estimate.confidence_grade;
  const factors = estimate.confidence_factors;
  const tooltip = [
    `Confidence: ${gradeDescription(grade)}`,
    `Data: ${factors.data_days} days`,
    `Sample size: n=${factors.sample_size}`,
    `Catalog match: ${Math.round(factors.catalog_match_pct * 100)}%`,
    factors.backtest_calibration != null
      ? `Backtest calibration: ${factors.backtest_calibration.toFixed(2)}×`
      : 'Backtest: pending',
    '',
    ...factors.notes.map((n) => `• ${n}`),
  ].join('\n');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums ${gradeClass(grade)}`}
      title={tooltip}
    >
      <span className="font-mono font-semibold">{grade}</span>
      <span className="opacity-70">{gradeShortLabel(grade)}</span>
    </span>
  );
}

function gradeClass(grade: string): string {
  switch (grade) {
    case 'A':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'B':
      return 'bg-sky-500/15 text-sky-300';
    case 'C':
      return 'bg-amber-500/15 text-amber-300';
    case 'D':
      return 'bg-orange-500/15 text-orange-300';
    case 'F':
    default:
      return 'bg-muted/30 text-muted-foreground';
  }
}

function gradeShortLabel(grade: string): string {
  switch (grade) {
    case 'A':
      return 'calibrated';
    case 'B':
      return 'stable';
    case 'C':
      return 'preliminary';
    case 'D':
      return 'early';
    case 'F':
    default:
      return 'baseline';
  }
}

function gradeDescription(grade: string): string {
  switch (grade) {
    case 'A':
      return 'A · calibrated against ≥1 quarterly disclosure';
    case 'B':
      return 'B · ≥1 month of stable methodology, ≥30% catalog match';
    case 'C':
      return 'C · ≥7 days of data, methodology unblocked';
    case 'D':
      return 'D · <7 days of data, preliminary';
    case 'F':
    default:
      return 'F · no real data, baseline only';
  }
}
