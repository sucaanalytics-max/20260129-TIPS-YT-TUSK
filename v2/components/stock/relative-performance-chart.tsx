'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { RelPerfRow } from '@/lib/queries';
import { AXIS, AXIS_TEXT, GRID, INK, SURFACE } from '@/lib/chart-palette';

interface SeriesInput {
  symbol: string;
  color: string;
  data: RelPerfRow[];
}

export function RelativePerformanceChart({
  series,
  indexLabel,
}: {
  series: SeriesInput[];
  indexLabel: string;
}) {
  if (series.every((s) => s.data.length === 0)) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no relative-performance data yet
      </div>
    );
  }

  // Merge series by date for a single chart dataset
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const s of series) {
    for (const r of s.data) {
      const slot = byDate.get(r.date) ?? { date: r.date };
      slot[s.symbol] = r.rel;
      byDate.set(r.date, slot);
    }
  }
  const merged = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">
        Relative performance vs {indexLabel}
      </h3>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Cumulative log-return difference (rebased to 0 at range start). Positive = outperforming.
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={merged} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
            formatter={(v: number) => `${(v * 100).toFixed(2)}%`}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          {/* Parity with the index is the benchmark every series is read against. */}
          <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
          {series.map((s) => (
            <Line
              key={s.symbol}
              type="monotone"
              dataKey={s.symbol}
              name={s.symbol}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
