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
import type { CompanyViewsRow } from '@/lib/queries';
import {
  MA_OPTIONS,
  MA_WINDOWS,
  rollingMeanField,
  type MASmoothing,
} from '@/lib/smoothing';

export function CompanyViewsLine({ data }: { data: CompanyViewsRow[] }) {
  const [smoothing, setSmoothing] = useState<MASmoothing>('7d');

  const smoothed = useMemo(() => {
    if (!data.length) return data;
    const w = MA_WINDOWS[smoothing];
    const a = rollingMeanField(data, 'tipsmusic', w);
    const b = rollingMeanField(a, 'saregama', w);
    return b.map((r) => ({
      ...r,
      tipsmusic: r.tipsmusic != null ? Math.round(r.tipsmusic) : null,
      saregama: r.saregama != null ? Math.round(r.saregama) : null,
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
          <h3 className="text-foreground text-sm font-medium">Daily views — Tips vs Saregama</h3>
          <p className="text-muted-foreground text-xs">
            Aggregate of all active channels per company
            {smoothing !== 'abs' ? ` · smoothed (${smoothing.toUpperCase()})` : ' · raw daily'}
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Views:</span>
          {MA_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSmoothing(opt.value)}
              className={`rounded-md border px-2.5 py-1 transition-colors ${
                smoothing === opt.value
                  ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={smoothed} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => abbrev(v)}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v: number) => v?.toLocaleString?.() ?? String(v)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="tipsmusic"
            name={`Tips ${smoothing !== 'abs' ? `(${smoothing.toUpperCase()})` : ''}`}
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="saregama"
            name={`Saregama ${smoothing !== 'abs' ? `(${smoothing.toUpperCase()})` : ''}`}
            stroke="#a78bfa"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
