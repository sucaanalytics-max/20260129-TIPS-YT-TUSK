'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import {
  AXIS,
  AXIS_TEXT,
  GRID,
  INK,
  NEUTRAL,
  seriesColor,
  SURFACE,
} from '@/lib/chart-palette';

interface PricePoint {
  date: string;
  close: number;
  adjusted_close: number | null;
  volume: number | null;
}

interface CorporateAction {
  ex_date: string;
  action_type: string;
  label: string;
}

export function PriceWithEvents({
  prices,
  corp_actions,
}: {
  prices: PricePoint[];
  corp_actions: CorporateAction[];
}) {
  if (!prices.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border text-sm">
        no price data yet
      </div>
    );
  }
  const priceByDate = new Map(prices.map((p) => [p.date, p.adjusted_close ?? p.close]));
  const dots = corp_actions
    .filter((a) => priceByDate.has(a.ex_date))
    .map((a) => ({
      x: a.ex_date,
      y: priceByDate.get(a.ex_date)!,
      label: a.label,
      action: a.action_type,
    }));

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">TIPSMUSIC adjusted close with corp-action markers</h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Dashed line = raw close · solid = corp-action-adjusted · each ringed marker is
        labelled with the corporate action it stands for
      </p>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={prices} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={(v) => `₹${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
            formatter={(v: number) => `₹${v.toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          <Line
            type="monotone"
            dataKey="adjusted_close"
            name="Adjusted close"
            stroke={seriesColor(0)}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="close"
            name="Raw close"
            stroke={NEUTRAL}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
          />
          {dots.map((d) => (
            <ReferenceDot
              key={`${d.x}-${d.action}`}
              x={d.x}
              y={d.y}
              r={5}
              fill={INK}
              stroke={SURFACE}
              strokeWidth={1.5}
              label={{ value: d.label, fill: INK, fontSize: 10, position: 'top' }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
