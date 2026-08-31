'use client';

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DriverContribution } from '@/lib/nowcast';
import { rupeesToCrore } from '@/lib/financials';
import { AXIS, AXIS_TEXT, GRID, INK, SERIES, SURFACE } from '@/lib/chart-palette';

/**
 * Driver composition of the nowcast midpoint, both companies on one scale.
 *
 * There are exactly three drivers and exactly three categorical slots in the
 * palette, so the mix fits without inventing a fourth hue. The segments are
 * stacked because they genuinely sum: computeNowcast prices each driver at the
 * same CPM and the parts add to band.mid by construction.
 *
 * Two views, because the two companies are an order of magnitude apart in
 * reach: rupees answers "how big", share answers "made of what". Neither one
 * alone is honest about both.
 */

export interface DriverMixRow {
  /** Company key, for a stable React key. */
  company: string;
  /** Display name. */
  label: string;
  contributions: DriverContribution[];
  /** Midpoint of the recomputed band, in RUPEES. */
  mid: number;
}

type Mode = 'crore' | 'share';

const DRIVERS = ['owned', 'topic', 'ugc'] as const;
type Driver = (typeof DRIVERS)[number];

const DRIVER_LABEL: Record<Driver, string> = {
  owned: 'Owned channels',
  topic: 'Topic / OAC attributed',
  ugc: 'UGC',
};

/** Fixed slot per driver, so a driver keeps its colour across both views. */
const DRIVER_COLOR: Record<Driver, string> = {
  owned: SERIES[0],
  topic: SERIES[1],
  ugc: SERIES[2],
};

/** Below this share the segment is too narrow to hold a legible label. */
const LABEL_MIN_SHARE = 14;

interface Datum {
  name: string;
  owned: number;
  topic: number;
  ugc: number;
  ownedLabel: string;
  topicLabel: string;
  ugcLabel: string;
}

function buildDatum(row: DriverMixRow, mode: Mode): Datum {
  const by = new Map(row.contributions.map((c) => [c.driver, c]));
  const value = (d: Driver): number => {
    const c = by.get(d);
    if (!c) return 0;
    // pctOfMid arrives from computeNowcast ALREADY on a 0-100 scale — it is
    // (mid / band.mid) * 100. Never multiply it by 100 again on the way out.
    // That mistake shipped once and printed "7143%".
    return mode === 'share' ? c.pctOfMid : rupeesToCrore(c.mid);
  };
  const share = (d: Driver): number => by.get(d)?.pctOfMid ?? 0;
  const text = (d: Driver): string =>
    share(d) < LABEL_MIN_SHARE ? '' : `${share(d).toFixed(0)}%`;

  return {
    name: row.label,
    owned: value('owned'),
    topic: value('topic'),
    ugc: value('ugc'),
    ownedLabel: text('owned'),
    topicLabel: text('topic'),
    ugcLabel: text('ugc'),
  };
}

function ModeSelector({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const options: { value: Mode; label: string }[] = [
    { value: 'crore', label: '₹ crore' },
    { value: 'share', label: 'Share %' },
  ];
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground mr-1">Scale:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
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

export function DriverMixChart({
  rows,
  ugcIncluded,
}: {
  rows: DriverMixRow[];
  ugcIncluded: boolean;
}) {
  const [mode, setMode] = useState<Mode>('crore');

  const priced = rows.filter((r) => r.mid > 0);
  if (!priced.length) {
    return (
      <div className="border-border bg-card text-muted-foreground flex h-64 items-center justify-center rounded-lg border p-6 text-sm">
        no driver mix to draw — every midpoint is zero, so nothing has been measured for this
        quarter yet
      </div>
    );
  }

  const data = priced.map((r) => buildDatum(r, mode));
  // The legend must not call UGC "excluded" if the assumption ever flips on.
  const legendLabel = (d: Driver): string =>
    d === 'ugc' && !ugcIncluded ? `${DRIVER_LABEL.ugc} (excluded)` : DRIVER_LABEL[d];
  const fmt = (v: number): string =>
    mode === 'share' ? `${v.toFixed(1)}%` : `₹${v.toFixed(2)}cr`;

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            What the midpoint is made of
          </h3>
          <p className="text-muted-foreground text-xs">
            Each bar is one company&rsquo;s full-quarter midpoint, split by driver. Segments sum to
            the midpoint — they are priced at the same rate, so they add.
          </p>
        </div>
        <ModeSelector value={mode} onChange={setMode} />
      </header>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        >
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis
            type="number"
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
            domain={mode === 'share' ? [0, 100] : undefined}
            tickFormatter={(v: number) => (mode === 'share' ? `${v}%` : `₹${v.toFixed(0)}cr`)}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            stroke={AXIS}
            tick={{ fontSize: 11, fill: AXIS_TEXT }}
          />
          <Tooltip
            cursor={{ fill: GRID }}
            contentStyle={{
              background: SURFACE,
              border: `1px solid ${AXIS}`,
              borderRadius: 6,
              color: INK,
            }}
            labelStyle={{ color: AXIS_TEXT }}
            formatter={(v) => fmt(Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: AXIS_TEXT }} />
          {DRIVERS.map((d) => (
            <Bar
              key={d}
              dataKey={d}
              stackId="mix"
              name={legendLabel(d)}
              fill={DRIVER_COLOR[d]}
            >
              {/* Segments carry their own share in text, so the split survives a
                  reader who cannot separate the three hues. */}
              <LabelList
                dataKey={`${d}Label`}
                position="insideLeft"
                fill={INK}
                fontSize={11}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>

      {!ugcIncluded ? (
        <p className="text-warning mt-2 text-xs">
          ⚠ UGC is measured but excluded from the estimate, so its segment is zero by
          construction — not missing. See Assumptions below.
        </p>
      ) : null}
    </div>
  );
}
