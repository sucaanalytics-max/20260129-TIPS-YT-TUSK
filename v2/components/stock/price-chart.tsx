'use client';

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

const SYMBOL_COLOR: Record<string, { price: string; adj: string }> = {
  TIPSMUSIC: { price: '#fbbf24', adj: '#60a5fa' },
  SAREGAMA: { price: '#f97316', adj: '#a78bfa' },
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

/**
 * Single-symbol price chart with adjusted-close overlay, corp-action markers,
 * and a volume pane beneath. For compare mode, render two of these stacked
 * (caller handles the layout).
 */
export function StockPriceChart({
  deepDive,
  compactVolume = true,
}: {
  deepDive: StockDeepDive;
  compactVolume?: boolean;
}) {
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
      <h3 className="text-foreground text-sm font-medium">
        {deepDive.symbol} · {deepDive.from} → {deepDive.to}
      </h3>
      <p className="text-muted-foreground text-xs">
        Solid = adjusted close · dashed = raw close · markers = corp actions
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={deepDive.prices} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            formatter={(v: number) => `₹${v.toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            type="monotone"
            dataKey="adjusted_close"
            name={`${deepDive.symbol} adj close`}
            stroke={c.adj}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="close"
            name={`${deepDive.symbol} raw close`}
            stroke={c.price}
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
 * Compare-mode price chart — two adjusted-close lines on one chart. No
 * volume pane (would be too noisy). No corp-action markers in compare mode
 * to keep it readable.
 */
export function StockPriceChartCompare({ deepDives }: { deepDives: StockDeepDive[] }) {
  if (deepDives.every((d) => d.prices.length === 0)) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-72 items-center justify-center rounded-lg border text-sm">
        no price data in this range
      </div>
    );
  }
  // Merge into one dataset by date.
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const d of deepDives) {
    for (const p of d.prices) {
      const slot = byDate.get(p.date) ?? { date: p.date };
      slot[`${d.symbol}_adj`] = p.adjusted_close ?? p.close;
      byDate.set(p.date, slot);
    }
  }
  const merged = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">
        Compare · adjusted close
      </h3>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Both symbols overlaid · corp-action markers omitted for readability
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={merged} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `₹${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
            }}
            formatter={(v: number) => `₹${v.toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {deepDives.map((d) => {
            const c = SYMBOL_COLOR[d.symbol] ?? SYMBOL_COLOR.TIPSMUSIC;
            return (
              <Line
                key={d.symbol}
                type="monotone"
                dataKey={`${d.symbol}_adj`}
                name={d.symbol}
                stroke={c.adj}
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
