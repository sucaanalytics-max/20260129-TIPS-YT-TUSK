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
import {
  AXIS,
  AXIS_TEXT,
  GRID,
  INK,
  NEUTRAL,
  SERIES,
  seriesColor,
  SURFACE,
} from '@/lib/chart-palette';

interface Props {
  byWindow: Record<number, RollingCorrelationRow[]>;
}

/**
 * Four windows overlaid on one axis, but only three categorical slots exist on
 * a light surface — every four-hue set fails the all-pairs CVD check. The
 * three shortest windows take the categorical slots in ascending order and the
 * longest folds into NEUTRAL rather than inventing a fourth hue. This chart
 * really wants faceting into four small multiples; until then the tail is
 * deliberately the most recessive line.
 */
const WINDOW_ORDER = [7, 30, 60, 120] as const;

function windowColor(win: number): string {
  const i = WINDOW_ORDER.indexOf(win as (typeof WINDOW_ORDER)[number]);
  return i >= 0 && i < SERIES.length ? seriesColor(i) : NEUTRAL;
}

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
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="asof" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} domain={[-1, 1]} />
          <Tooltip
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          {/* r = 0 is the null every window is read against. */}
          <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
          {Object.entries(byWindow).map(([win, rows]) => (
            <Line
              key={win}
              type="monotone"
              dataKey={`r_${win}`}
              name={`${win}d window`}
              stroke={windowColor(Number(win))}
              strokeWidth={2}
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
                  fill={windowColor(Number(win))}
                  fillOpacity={0.28}
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
