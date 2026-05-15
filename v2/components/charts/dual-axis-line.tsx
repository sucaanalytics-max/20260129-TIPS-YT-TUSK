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
import type { DualAxisRow } from '@/lib/queries';
import { MA_OPTIONS, MA_WINDOWS, rollingMeanField, type MASmoothing } from '@/lib/smoothing';

export function DualAxisLine({ data }: { data: DualAxisRow[] }) {
  const [smoothing, setSmoothing] = useState<MASmoothing>('abs');

  const smoothed = useMemo(() => {
    if (!data.length) return data;
    const window = MA_WINDOWS[smoothing];
    return rollingMeanField(data, 'daily_views', window).map((r) => ({
      ...r,
      // Round to int after smoothing so tooltips don't show 12345.6789
      daily_views: r.daily_views != null ? Math.round(r.daily_views) : null,
    }));
  }, [data, smoothing]);

  if (!data.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border text-sm">
        no time series yet — waiting on first ingest
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">Daily views vs TIPSMUSIC close</h3>
          <p className="text-muted-foreground text-xs">
            Adjusted close shown when corporate-action history present
            {smoothing !== 'abs' ? ` · views smoothed (${smoothing.toUpperCase()})` : null}
          </p>
        </div>
        <MASelector value={smoothing} onChange={setSmoothing} />
      </header>

      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={smoothed} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="views"
            orientation="left"
            stroke="#60a5fa"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => abbrev(v)}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            stroke="#fbbf24"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `₹${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="views"
            type="monotone"
            dataKey="daily_views"
            name={smoothing === 'abs' ? 'Daily views' : `Daily views (${smoothing.toUpperCase()})`}
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="adjusted_close"
            name="TIPSMUSIC adjusted close"
            stroke="#fbbf24"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            name="TIPSMUSIC close (raw)"
            stroke="#f97316"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MASelector({
  value,
  onChange,
  label = 'Views',
}: {
  value: MASmoothing;
  onChange: (v: MASmoothing) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground mr-1">{label}:</span>
      {MA_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md border px-2.5 py-1 transition-colors ${
            value === opt.value
              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
