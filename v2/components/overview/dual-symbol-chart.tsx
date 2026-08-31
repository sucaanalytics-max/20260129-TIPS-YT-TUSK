'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { DualSymbolChartRow } from '@/lib/queries';
import { MASelector } from '@/components/charts/dual-axis-line';
import { MA_WINDOWS, rollingMeanField, type MASmoothing } from '@/lib/smoothing';
import {
  AXIS,
  AXIS_TEXT,
  COMPANY_COLOR,
  GRID,
  INK,
  SURFACE,
} from '@/lib/chart-palette';

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

type TickerFilter = 'both' | 'tips' | 'sare';

const TICKER_OPTIONS: { value: TickerFilter; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'tips', label: 'TIPS' },
  { value: 'sare', label: 'SARE' },
];

function TickerSelector({
  value,
  onChange,
}: {
  value: TickerFilter;
  onChange: (v: TickerFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground mr-1">Show:</span>
      {TICKER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md border px-2.5 py-1 transition-colors ${
            value === opt.value
              ? 'border-foreground bg-foreground/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function DualSymbolChart({ data }: { data: DualSymbolChartRow[] }) {
  const [smoothing, setSmoothing] = useState<MASmoothing>('7d');
  const [ticker, setTicker] = useState<TickerFilter>('both');
  const showTips = ticker !== 'sare';
  const showSare = ticker !== 'tips';

  const smoothed = useMemo(() => {
    if (!data.length) return data;
    const w = MA_WINDOWS[smoothing];
    let acc = data;
    acc = rollingMeanField(acc, 'tips_views', w);
    acc = rollingMeanField(acc, 'sare_views', w);
    return acc.map((r) => ({
      ...r,
      tips_views: r.tips_views != null ? Math.round(r.tips_views) : null,
      sare_views: r.sare_views != null ? Math.round(r.sare_views) : null,
    }));
  }, [data, smoothing]);

  if (!data.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no chart data yet — waiting on first ingest
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            Daily views × adjusted close — TIPS vs SARE
          </h3>
          <p className="text-muted-foreground text-xs">
            Left axis: daily views (solid) · Right axis: ₹ adjusted close (dashed) · colour =
            company
            {smoothing !== 'abs' ? ` · views smoothed (${smoothing.toUpperCase()})` : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TickerSelector value={ticker} onChange={setTicker} />
          <MASelector value={smoothing} onChange={setSmoothing} />
        </div>
      </header>

      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={smoothed} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis dataKey="date" stroke={AXIS} tick={{ fontSize: 11, fill: AXIS_TEXT }} />
          {/* Both companies appear on both axes, so the axes stay furniture and
              the two measures are separated by line style instead. */}
          <YAxis
            yAxisId="views"
            orientation="left"
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            tickFormatter={(v) => abbrev(v)}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
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
            labelStyle={{ color: AXIS_TEXT }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          {showTips && (
            <Line
              yAxisId="views"
              type="monotone"
              dataKey="tips_views"
              name="TIPS views"
              stroke={COMPANY_COLOR.TIPSMUSIC}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
          {showSare && (
            <Line
              yAxisId="views"
              type="monotone"
              dataKey="sare_views"
              name="SARE views"
              stroke={COMPANY_COLOR.SAREGAMA}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          )}
          {showTips && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="tips_close"
              name="TIPS price"
              stroke={COMPANY_COLOR.TIPSMUSIC}
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
            />
          )}
          {showSare && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sare_close"
              name="SARE price"
              stroke={COMPANY_COLOR.SAREGAMA}
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
