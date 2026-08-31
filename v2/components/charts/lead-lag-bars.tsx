'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LeadLagRow } from '@/lib/queries';
import { AXIS, AXIS_TEXT, GRID, INK, NEUTRAL, STATUS, SURFACE } from '@/lib/chart-palette';

export function LeadLagBars({ data, windowDays }: { data: LeadLagRow[]; windowDays: number }) {
  if (!data.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border text-sm">
        no lead-lag scan yet — run /api/stats/recompute
      </div>
    );
  }
  const max = data.reduce((acc, r) => (Math.abs(r.pearson_r) > Math.abs(acc.pearson_r) ? r : acc), data[0]);

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">
        Lead-lag scan — {windowDays}d window
      </h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Positive lag = views lead returns by N days · peak r = {max.pearson_r.toFixed(3)} at lag {max.lag_days}
      </p>
      {/* Significance is carried by the outline and by this key, not by hue
          alone — a bar that clears the 5% threshold is drawn with an ink edge. */}
      <p className="text-muted-foreground mb-3 text-xs">
        <span
          className="mr-1 inline-block h-2.5 w-2.5 align-middle"
          style={{ background: STATUS.good, outline: `1px solid ${INK}` }}
        />
        outlined = significant at 5% ·{' '}
        <span
          className="mr-1 inline-block h-2.5 w-2.5 align-middle"
          style={{ background: NEUTRAL, opacity: 0.55 }}
        />
        plain = not significant
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="lag_days" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} domain={[-1, 1]} />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
          />
          <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
          <Bar dataKey="pearson_r" name="Pearson r">
            {data.map((r) => (
              <Cell
                key={r.lag_days}
                fill={r.is_significant ? STATUS.good : NEUTRAL}
                fillOpacity={r.is_significant ? 1 : 0.55}
                stroke={r.is_significant ? INK : 'none'}
                strokeWidth={1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
