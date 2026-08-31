'use client';

import { useMemo, useState } from 'react';
import type { ControlChartResult } from '@/lib/queries';
import { METRIC_LABEL } from '@/lib/metrics';
import { AXIS, BAND_FILL, INK, NEUTRAL, STATUS } from '@/lib/chart-palette';

const W = 1160;
const H = 300;
const PAD = 8;

const fmt = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
};

/**
 * Shewhart control chart. Limits are toggleable because they are a reading aid,
 * not part of the data — and when the process is skewed they are actively
 * misleading, which the caption says out loud rather than leaving implied.
 */
export function ControlChart({ data }: { data: ControlChartResult }) {
  const [showLimits, setShowLimits] = useState(true);
  const { chart, metric, company, from, to } = data;
  const { limits, points, movingAverages, violations, skew } = chart;

  const scale = useMemo(() => {
    const vals = points.map((p) => p.value).filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    const lo = Math.min(...vals, limits?.lcl2 ?? Infinity);
    const hi = Math.max(...vals, limits?.ucl2 ?? -Infinity);
    const span = hi - lo || 1;
    return {
      lo,
      hi,
      x: (i: number) => (i * W) / Math.max(1, points.length - 1),
      y: (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2),
    };
  }, [points, limits]);

  if (!scale || !limits) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">
          {METRIC_LABEL[metric]} · {company}
        </h3>
        <p className="text-muted-foreground mt-2 text-xs">
          Not enough observations in this window to compute control limits.
        </p>
      </div>
    );
  }

  const line = (vals: Array<number | null>) =>
    vals
      .map((v, i) => (v == null ? null : `${scale.x(i).toFixed(1)},${scale.y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');

  // ±2σ is the breach threshold, so it takes the warning colour; ±1σ and the
  // centre line are reading furniture and stay recessive.
  const limitRows: Array<[string, number, string, boolean]> = [
    ['+2σ', limits.ucl2, STATUS.warning, true],
    ['+1σ', limits.ucl1, AXIS, false],
    ['x̄', limits.mean, NEUTRAL, false],
    ['−1σ', limits.lcl1, AXIS, false],
    ['−2σ', limits.lcl2, STATUS.warning, true],
  ];
  const violationIdx = new Set(violations.map((v) => v.date));

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {METRIC_LABEL[metric]} · {company}
          </h3>
          <p className="text-muted-foreground text-xs tabular-nums">
            {from} – {to} · x̄ {fmt(limits.mean)} · σ {fmt(limits.sd)} · n {limits.n}
          </p>
        </div>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs select-none">
          <input
            type="checkbox"
            checked={showLimits}
            onChange={(e) => setShowLimits(e.target.checked)}
            className="accent-blue-500"
          />
          Control lines
        </label>
      </header>

      <div className="relative pr-14">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[300px] w-full"
        >
          {showLimits ? (
            <>
              <rect
                x={0}
                y={scale.y(limits.ucl1)}
                width={W}
                height={Math.max(0, scale.y(limits.lcl1) - scale.y(limits.ucl1))}
                fill={BAND_FILL}
              />
              {limitRows.map(([label, v, color, dashed]) => (
                <line
                  key={label}
                  x1={0}
                  x2={W}
                  y1={scale.y(v)}
                  y2={scale.y(v)}
                  stroke={color}
                  strokeWidth={label === 'x̄' ? 1.5 : 1}
                  strokeDasharray={dashed ? '6 4' : undefined}
                />
              ))}
            </>
          ) : null}
          {/* The daily trace is the raw material; the 30-day mean is the line
              the caption tells you to read, so it carries the ink weight. */}
          <polyline fill="none" stroke={NEUTRAL} strokeWidth={1.25} points={line(points.map((p) => p.value))} />
          {movingAverages[30] ? (
            <polyline fill="none" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" points={line(movingAverages[30])} />
          ) : null}
          {showLimits
            ? points.map((p, i) =>
                p.value != null && violationIdx.has(p.date) ? (
                  <circle key={p.date} cx={scale.x(i)} cy={scale.y(p.value)} r={9} fill="none" stroke={STATUS.warning} strokeWidth={3} />
                ) : null,
              )
            : null}
        </svg>

        {showLimits ? (
          <div className="absolute right-0 top-0 h-[300px] w-12 font-mono text-[9px]">
            {limitRows.map(([label, v, color]) => (
              <div
                key={label}
                className="absolute"
                style={{ top: `${scale.y(v) - 6}px`, color }}
              >
                {label}
                <br />
                <span className="text-muted-foreground">{fmt(v)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3.5" style={{ background: NEUTRAL }} />daily
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5" style={{ background: INK }} />30-day mean
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ border: `2px solid ${STATUS.warning}` }}
          />
          ringed = outside ±2σ
        </span>
        {([15, 45, 90] as const).map((w) =>
          movingAverages[w] ? (
            <span key={w} className="tabular-nums">
              MA{w} {fmt([...movingAverages[w]].reverse().find((v) => v != null) ?? 0)}
            </span>
          ) : null,
        )}
        <span className="ml-auto tabular-nums">
          {violations.length} of {limits.n} outside ±2σ ·{' '}
          {((violations.length / limits.n) * 100).toFixed(1)}%
        </span>
      </div>

      {skew.oneSided ? (
        <p className="mt-2 text-[11px]" style={{ color: STATUS.warning }}>
          ⚠️ {skew.above} breaches above and {skew.below} below. A symmetric process splits
          them, so these limits are indicative, not valid — read the moving average, not the
          envelope.
        </p>
      ) : (
        <p className="text-muted-foreground/70 mt-2 text-[11px]">
          A normal process puts ~4.6% outside ±2σ; this one is at{' '}
          {((violations.length / limits.n) * 100).toFixed(1)}%.
        </p>
      )}
    </div>
  );
}
