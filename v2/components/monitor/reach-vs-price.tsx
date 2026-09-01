'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_TEXT, GRID } from '@/lib/chart-palette';

export interface IndexedPoint {
  date: string;
  tipsViews: number | null;
  tipsPrice: number | null;
  sareViews: number | null;
  sarePrice: number | null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function tick(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface rounded-md border px-3 py-2 font-mono text-[11px] shadow-card">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-0.5 w-3" style={{ background: p.color }} />
          <span className="text-ink2 flex-1">{p.name}</span>
          <span className="text-ink">{p.value == null ? '—' : p.value.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Reach against price, both rebased to 100 at the window start.
 *
 * Colour carries the COMPANY and line style carries the MEASURE — solid for
 * views, dashed for price. That is two colours and two styles rather than four
 * colours, which keeps the chart inside the validated palette and keeps a
 * company the same colour it is on every other screen.
 */
export function ReachVsPrice({
  data,
  correlation,
}: {
  data: IndexedPoint[];
  /** Pearson r on log changes, with the n it was computed over. */
  correlation: { r: number | null; n: number; criticalR: number | null };
}) {
  const { r, n, criticalR } = correlation;
  const significant = r != null && criticalR != null && Math.abs(r) >= criticalR;

  return (
    <div>
      <div className="p-pad pt-0">
        <ResponsiveContainer width="100%" height={330}>
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={tick}
              minTickGap={64}
              tick={{ fill: AXIS_TEXT, fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={{ stroke: 'rgb(var(--border2))' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: AXIS_TEXT, fontSize: 10, fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={['auto', 'auto']}
            />
            {/* The base everything is measured from. */}
            <ReferenceLine y={100} stroke="rgb(var(--border2))" strokeDasharray="3 3" />
            <Tooltip content={<TooltipBox />} />
            <Line type="monotone" dataKey="tipsViews" name="TIPS views" stroke="rgb(var(--tips))" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="tipsPrice" name="TIPS price" stroke="rgb(var(--tips))" strokeWidth={1.6} strokeDasharray="4 4" dot={false} connectNulls={false} opacity={0.75} />
            <Line type="monotone" dataKey="sareViews" name="SARE views" stroke="rgb(var(--sare))" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="sarePrice" name="SARE price" stroke="rgb(var(--sare))" strokeWidth={1.6} strokeDasharray="4 4" dot={false} connectNulls={false} opacity={0.75} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* The read-out is the point of the chart. A correlation without its n and
          its significance is a number people over-read. */}
      <p className="text-ink2 border-border m-0 border-t px-pad py-3 text-xs leading-relaxed">
        {r == null || n < 3 ? (
          <>Not enough paired days in this window to compute a correlation. Nothing is implied by the shape of the lines alone.</>
        ) : (
          <>
            TIPS views against TIPS price: r = {r.toFixed(2)} over {n} paired days
            {criticalR != null ? `, critical r = ${criticalR.toFixed(2)} at p&lt;0.05` : ''}.{' '}
            {significant
              ? 'This clears the significance floor for this window.'
              : 'This does not clear the significance floor — on the evidence here, attention and price are not related in this window.'}
          </>
        )}
      </p>
    </div>
  );
}
