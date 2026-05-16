'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { StockDeepDive } from '@/lib/queries';
import { MASelector } from '@/components/charts/dual-axis-line';
import { MA_WINDOWS, rollingMeanArray, type MASmoothing } from '@/lib/smoothing';

const SYMBOL_COLOR: Record<string, { price: string; adj: string; views: string }> = {
  TIPSMUSIC: { price: '#fbbf24', adj: '#60a5fa', views: '#22d3ee' },
  SAREGAMA: { price: '#f97316', adj: '#a78bfa', views: '#f472b6' },
};

const MARKER_COLOR: Record<string, string> = {
  split: '#ef4444',
  bonus: '#f59e0b',
  dividend: '#34d399',
  rights: '#a78bfa',
  merger: '#ec4899',
};

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** Build merged date-axis rows: union of price dates ∪ view dates. */
function mergePriceAndViews(
  deepDive: StockDeepDive,
  smoothedViews: Array<number | null>,
): Array<Record<string, number | string | null>> {
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const p of deepDive.prices) {
    byDate.set(p.date, {
      date: p.date,
      close: p.close,
      adjusted_close: p.adjusted_close,
      volume: p.volume,
      daily_views: null,
    });
  }
  for (let i = 0; i < deepDive.views.length; i++) {
    const v = deepDive.views[i];
    const slot = byDate.get(v.date) ?? { date: v.date, close: null, adjusted_close: null, volume: null, daily_views: null };
    slot.daily_views = smoothedViews[i];
    byDate.set(v.date, slot);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

/**
 * Single-symbol price chart with adjusted-close overlay, corp-action markers,
 * and a YouTube daily-views overlay on a secondary right axis. Volume bars
 * render in a separate pane below — unchanged behavior.
 */
export function StockPriceChart({
  deepDive,
  compactVolume = true,
}: {
  deepDive: StockDeepDive;
  compactVolume?: boolean;
}) {
  const [smoothing, setSmoothing] = useState<MASmoothing>('7d');

  const smoothedViews = useMemo(
    () => rollingMeanArray(deepDive.views.map((v) => v.daily_views), MA_WINDOWS[smoothing]),
    [deepDive.views, smoothing],
  );

  const merged = useMemo(
    () => mergePriceAndViews(deepDive, smoothedViews),
    [deepDive, smoothedViews],
  );

  if (!deepDive.prices.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no price data for {deepDive.symbol} in this range
      </div>
    );
  }
  const c = SYMBOL_COLOR[deepDive.symbol] ?? SYMBOL_COLOR.TIPSMUSIC;
  const priceByDate = new Map(
    deepDive.prices.map((p) => [p.date, p.adjusted_close ?? p.close]),
  );
  const dots = deepDive.corp_actions
    .filter((a) => priceByDate.has(a.ex_date))
    .map((a) => ({
      x: a.ex_date,
      y: priceByDate.get(a.ex_date)!,
      label: a.label,
      action: a.action_type,
    }));

  return (
    <div className="border-border bg-card space-y-1 rounded-lg border p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            {deepDive.symbol} · {deepDive.from} → {deepDive.to}
          </h3>
          <p className="text-muted-foreground text-xs">
            Solid = adjusted close · dashed = raw close · markers = corp actions · {c.views === '#22d3ee' ? 'cyan' : 'pink'} = YT daily views (right axis)
            {smoothing !== 'abs' ? ` · views smoothed (${smoothing.toUpperCase()})` : null}
          </p>
        </div>
        <MASelector value={smoothing} onChange={setSmoothing} label="Views" />
      </header>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={merged} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="price"
            orientation="left"
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
          />
          <YAxis
            yAxisId="views"
            orientation="right"
            stroke={c.views}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => abbrev(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            formatter={(v: number, name: string) =>
              name.includes('views') ? abbrev(v) : `₹${v.toFixed(2)}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="adjusted_close"
            name={`${deepDive.symbol} adj close`}
            stroke={c.adj}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            name={`${deepDive.symbol} raw close`}
            stroke={c.price}
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="views"
            type="monotone"
            dataKey="daily_views"
            name={`${deepDive.symbol} YT views`}
            stroke={c.views}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          {dots.map((d) => (
            <ReferenceDot
              key={`${d.x}-${d.action}`}
              x={d.x}
              y={d.y}
              yAxisId="price"
              r={5}
              fill={MARKER_COLOR[d.action] ?? '#94a3b8'}
              stroke="rgba(15,23,42,0.9)"
              label={{ value: d.label, fill: '#cbd5e1', fontSize: 10, position: 'top' }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={compactVolume ? 80 : 140}>
        <BarChart data={deepDive.prices} margin={{ top: 0, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 10 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} tickFormatter={(v: number) => abbrev(v)} />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            formatter={(v: number) => v.toLocaleString()}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <Bar dataKey="volume" name="Volume" fill={c.adj} fillOpacity={0.5} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Compare-mode price chart — two adj-close lines + two YT daily-views lines
 * on dual axes. Corp-action markers omitted to keep four lines readable.
 */
export function StockPriceChartCompare({ deepDives }: { deepDives: StockDeepDive[] }) {
  const [smoothing, setSmoothing] = useState<MASmoothing>('7d');

  const smoothedByDeep = useMemo(
    () =>
      deepDives.map((d) =>
        rollingMeanArray(d.views.map((v) => v.daily_views), MA_WINDOWS[smoothing]),
      ),
    [deepDives, smoothing],
  );

  const merged = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    function slot(date: string) {
      const s = byDate.get(date) ?? { date };
      byDate.set(date, s);
      return s;
    }
    deepDives.forEach((d, di) => {
      for (const p of d.prices) {
        slot(p.date)[`${d.symbol}_adj`] = p.adjusted_close ?? p.close;
      }
      const s = smoothedByDeep[di];
      d.views.forEach((v, i) => {
        slot(v.date)[`${d.symbol}_views`] = s[i];
      });
    });
    return Array.from(byDate.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [deepDives, smoothedByDeep]);

  if (deepDives.every((d) => d.prices.length === 0)) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no price data in this range
      </div>
    );
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            Compare · adjusted close + YT daily views
          </h3>
          <p className="text-muted-foreground text-xs">
            Left axis: ₹ adjusted close · Right axis: YT daily views · corp-action markers omitted
            {smoothing !== 'abs' ? ` · views smoothed (${smoothing.toUpperCase()})` : null}
          </p>
        </div>
        <MASelector value={smoothing} onChange={setSmoothing} label="Views" />
      </header>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={merged} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="price"
            orientation="left"
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
          />
          <YAxis
            yAxisId="views"
            orientation="right"
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => abbrev(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            formatter={(v: number, name: string) =>
              name.includes('views') ? abbrev(v) : `₹${v.toFixed(2)}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {deepDives.map((d) => {
            const c = SYMBOL_COLOR[d.symbol] ?? SYMBOL_COLOR.TIPSMUSIC;
            return (
              <Line
                key={`${d.symbol}-adj`}
                yAxisId="price"
                type="monotone"
                dataKey={`${d.symbol}_adj`}
                name={`${d.symbol} adj close`}
                stroke={c.adj}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            );
          })}
          {deepDives.map((d) => {
            const c = SYMBOL_COLOR[d.symbol] ?? SYMBOL_COLOR.TIPSMUSIC;
            return (
              <Line
                key={`${d.symbol}-views`}
                yAxisId="views"
                type="monotone"
                dataKey={`${d.symbol}_views`}
                name={`${d.symbol} YT views`}
                stroke={c.views}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
