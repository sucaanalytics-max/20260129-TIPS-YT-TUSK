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

const MARKER_COLOR: Record<string, string> = {
  split: '#ef4444',
  bonus: '#f59e0b',
  dividend: '#34d399',
  rights: '#a78bfa',
  merger: '#ec4899',
};

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
        Dashed line = raw close · solid = corp-action-adjusted
      </p>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={prices} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `₹${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
            formatter={(v: number) => `₹${v.toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="adjusted_close"
            name="Adjusted close"
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="close"
            name="Raw close"
            stroke="#f97316"
            strokeWidth={1}
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
              fill={MARKER_COLOR[d.action] ?? '#94a3b8'}
              stroke="rgba(15,23,42,0.9)"
              label={{ value: d.label, fill: '#cbd5e1', fontSize: 10, position: 'top' }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
