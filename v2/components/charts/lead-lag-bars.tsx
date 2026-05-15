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
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="lag_days" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[-1, 1]} />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <Bar dataKey="pearson_r" name="Pearson r">
            {data.map((r) => (
              <Cell
                key={r.lag_days}
                fill={r.is_significant ? '#10b981' : 'rgba(148,163,184,0.6)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
