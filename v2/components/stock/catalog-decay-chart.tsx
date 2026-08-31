'use client';

import {
  CartesianGrid,
  Line,
  Scatter,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { DecayCurve } from '@/lib/signals';
import {
  AXIS,
  AXIS_TEXT,
  GRID,
  INK,
  seriesColor,
  SURFACE,
} from '@/lib/chart-palette';

interface DecayPoint {
  video_age_days: number;
  daily_views: number;
}

/**
 * Log-log scatter of (video_age_days, daily_views) with the fitted power-law
 * decay line overlaid. The fit is computed server-side via fitCatalogDecay().
 *
 * Chart geometry: x-axis is log10(1+age), y-axis is log10(views). Recharts
 * doesn't render log axes natively in ComposedChart, so we transform values
 * to logs and label them via the tickFormatter as their original integer
 * domain (10^x reversed).
 */
export function CatalogDecayChart({
  observations,
  fit,
  symbol,
}: {
  observations: DecayPoint[];
  fit: DecayCurve | null;
  symbol: string;
}) {
  if (observations.length === 0 || fit == null) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no catalog decay data yet — need ≥ 30 (video, day) observations
      </div>
    );
  }

  // Downsample to ≤ 400 points if needed (random sample)
  const sampled =
    observations.length <= 400
      ? observations
      : observations
          .map((o) => ({ o, k: Math.random() }))
          .sort((a, b) => a.k - b.k)
          .slice(0, 400)
          .map((x) => x.o);

  // Log-transform
  const scatter = sampled.map((p) => ({
    log_age: Math.log10(1 + p.video_age_days),
    log_views: Math.log10(p.daily_views),
  }));

  // Fitted line: log10(views) = log10(a) - b * log10(1+age) * ln(10)/ln(10)
  // The natural-log fit was: ln(views) = ln(a) - b * ln(1+age)
  // In log10: log10(views) = log10(a) - b * log10(1+age)
  const maxLogAge = Math.max(...scatter.map((s) => s.log_age));
  const minLogAge = 0; // age=0 → log10(1)=0
  const fitLine = [
    { log_age: minLogAge, log_views: Math.log10(fit.a) },
    { log_age: maxLogAge, log_views: Math.log10(fit.a) - fit.b * maxLogAge },
  ];

  function fmt10(v: number): string {
    const raw = 10 ** v;
    if (raw >= 1e6) return `${(raw / 1e6).toFixed(1)}M`;
    if (raw >= 1e3) return `${(raw / 1e3).toFixed(0)}k`;
    if (raw >= 1) return raw.toFixed(0);
    return raw.toFixed(2);
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {symbol} catalog decay · power-law fit
          </h3>
          <p className="text-muted-foreground text-xs">
            views(t) = {fit.a.toFixed(0)} × (1 + t)<sup>−{fit.b.toFixed(3)}</sup>
            {' · '}R² = {fit.r_squared.toFixed(3)}
            {' · '}n = {fit.n_observations.toLocaleString()} obs
          </p>
        </div>
      </header>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={scatter} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis
            type="number"
            dataKey="log_age"
            domain={[0, 'dataMax']}
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={(v: number) => `${Math.round(10 ** v - 1)}d`}
            label={{ value: 'video age (days, log)', position: 'insideBottom', offset: -2, fill: AXIS_TEXT, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="log_views"
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={fmt10}
            label={{ value: 'daily views (log)', angle: -90, position: 'insideLeft', fill: AXIS_TEXT, fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
            formatter={(v: number, name: string) =>
              name === 'log_views'
                ? `${fmt10(v)} views`
                : name === 'log_age'
                  ? `${Math.round(10 ** v - 1)}d`
                  : v
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          <Scatter
            name="(age, views) sample"
            data={scatter}
            fill={seriesColor(0)}
            fillOpacity={0.55}
            line={false}
            shape="circle"
          />
          {/* The fit is the reference the cloud is read against, so it is ink
              and heavier than the marks it summarises. */}
          <Line
            name="power-law fit"
            data={fitLine}
            dataKey="log_views"
            stroke={INK}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
