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
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="day" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
            formatter={(v: number) => `${v.toFixed(2)}%`}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" label={{ value: 'event', fill: '#94a3b8', fontSize: 10 }} />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="#60a5fa"
            fillOpacity={0.15}
            isAnimationActive={false}
            name="95% CI"
          />
          <Line
            type="monotone"
            dataKey="car_pct"
            name="Mean CAR"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={{ r: 3, fill: '#60a5fa' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
