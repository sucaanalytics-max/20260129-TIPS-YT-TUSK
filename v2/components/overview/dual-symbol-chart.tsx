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
            Left axis: daily views · Right axis: ₹ adjusted close
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
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            labelStyle={{ color: '#cbd5e1' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {showTips && (
            <Line
              yAxisId="views"
              type="monotone"
              dataKey="tips_views"
              name="TIPS views"
              stroke="#60a5fa"
              strokeWidth={1.5}
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
              stroke="#a78bfa"
              strokeWidth={1.5}
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
              stroke="#fbbf24"
              strokeWidth={1.5}
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
              stroke="#f97316"
              strokeWidth={1.5}
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
