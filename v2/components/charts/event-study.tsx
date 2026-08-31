'use client';

import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EventStudyRow } from '@/lib/queries';
import {
  AXIS,
  AXIS_TEXT,
  BAND_FILL,
  GRID,
  INK,
  seriesColor,
  SURFACE,
} from '@/lib/chart-palette';

export function EventStudyChart({ rows, eventType }: { rows: EventStudyRow[]; eventType: string }) {
  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border text-sm">
        no event-study output for &lsquo;{eventType}&rsquo; — run /api/stats/event-study
      </div>
    );
  }

  // Convert AR to %
  const data = rows.map((r) => ({
    day: r.day_offset,
    car_pct: r.mean_car * 100,
    lo_pct: r.ci_lo * 100,
    hi_pct: r.ci_hi * 100,
    band: [r.ci_lo * 100, r.ci_hi * 100],
    n: r.n_obs,
  }));

  const n = rows[0].n_obs;
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">
        Event-study CAR — {eventType} <span className="text-muted-foreground font-normal">(n = {n})</span>
      </h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Market-model abnormal returns vs NIFTY MIDCAP 150 · 95% bootstrap CI
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="day" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
            formatter={(v: number) => `${v.toFixed(2)}%`}
          />
          {/* Zero abnormal return and the event day are the two references the
              CAR path is read against, so both are drawn in ink. */}
          <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
          <ReferenceLine
            x={0}
            stroke={INK}
            strokeWidth={1.5}
            strokeDasharray="2 2"
            label={{ value: 'event', fill: AXIS_TEXT, fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill={BAND_FILL}
            fillOpacity={1}
            isAnimationActive={false}
            name="95% CI"
          />
          <Line
            type="monotone"
            dataKey="car_pct"
            name="Mean CAR"
            stroke={seriesColor(0)}
            strokeWidth={2}
            dot={{ r: 4, fill: seriesColor(0), stroke: SURFACE, strokeWidth: 1 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
