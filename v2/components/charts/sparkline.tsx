/**
 * Inline SVG sparkline — no Recharts, no tooltips, no axes. Cheap to render
 * 38+ of these per table without affecting React performance.
 *
 * Null values are skipped — the path connects across them so weekend gaps
 * don't visually break the trend. Returns null if every value is null.
 */
export function Sparkline({
  values,
  width = 120,
  height = 24,
  color = '#60a5fa',
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
}) {
  const valid = values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as Array<{
    v: number;
    i: number;
  }>;
  if (valid.length === 0) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth={1} strokeDasharray="2 3" />
      </svg>
    );
  }

  const min = Math.min(...valid.map((p) => p.v));
  const max = Math.max(...valid.map((p) => p.v));
  const range = max - min || 1;

  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * (width - 2) + 1 : width / 2);
  const y = (v: number) => height - 1 - ((v - min) / range) * (height - 2);

  const d = valid
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`)
    .join(' ');

  const lastY = y(valid[valid.length - 1].v);
  const lastX = x(valid[valid.length - 1].i);

  return (
    <svg width={width} height={height} role="img" aria-label="60-day daily views trend">
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={1.6} fill={color} />
    </svg>
  );
}
