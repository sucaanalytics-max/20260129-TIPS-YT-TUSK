'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { RollingCorrelationRow } from '@/lib/queries';

interface Props {
  byWindow: Record<number, RollingCorrelationRow[]>;
}

const COLORS: Record<number, string> = {
  7: '#fbbf24',
  30: '#60a5fa',
  60: '#a78bfa',
  120: '#34d399',
};

export function RollingCorrelation({ byWindow }: Props) {
  const merged = mergeByDate(byWindow);
  if (!merged.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border text-sm">
        no correlation history — run /api/stats/recompute
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">
        Rolling correlation — log-growth-views × log-return (lag 0)
      </h3>
      <p className="text-muted-foreground mb-3 text-xs">
        Multiple window sizes overlaid · shaded zones = FDR-significant
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={merged} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="asof" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[-1, 1]} />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
          {Object.entries(byWindow).map(([win, rows]) => (
            <Line
              key={win}
              type="monotone"
              dataKey={`r_${win}`}
              name={`${win}d window`}
              stroke={COLORS[Number(win)] ?? '#94a3b8'}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
          {Object.entries(byWindow).flatMap(([win, rows]) =>
            rows
              .filter((r) => r.is_significant)
              .map((r) => (
                <ReferenceArea
                  key={`sig-${win}-${r.asof}`}
                  x1={r.asof}
                  x2={r.asof}
                  fill={COLORS[Number(win)] ?? '#94a3b8'}
                  fillOpacity={0.08}
                  ifOverflow="extendDomain"
                />
              )),
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function mergeByDate(byWindow: Record<number, RollingCorrelationRow[]>): Array<Record<string, number | string>> {
  const dates = new Set<string>();
  for (const rows of Object.values(byWindow)) {
    for (const r of rows) dates.add(r.asof);
  }
  return Array.from(dates)
    .sort()
    .map((asof) => {
      const row: Record<string, number | string> = { asof };
      for (const [win, rows] of Object.entries(byWindow)) {
        const match = rows.find((x) => x.asof === asof);
        if (match) row[`r_${win}`] = match.pearson_r;
      }
      return row;
    });
}
