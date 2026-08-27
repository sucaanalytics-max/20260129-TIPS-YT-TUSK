'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { CompanyViewsRow, TotalReachResult } from '@/lib/queries';
import {
  MA_OPTIONS,
  MA_WINDOWS,
  rollingMeanField,
  type MASmoothing,
} from '@/lib/smoothing';

/** Cumulative UGC "discovered reach" headline (from getUGCReach) — shown
 * SEPARATELY from the owned+topic flow line (different time base + sampled). */
export interface UgcHeadline {
  attributed_views: number;
  ugc_shorts_count: number;
  latestAsof: string | null;
  grade: string;
}

type Mode = 'owned' | 'total';
type TotalCompany = 'TIPSMUSIC' | 'SAREGAMA' | 'both';

const TIPS_COLOR = '#60a5fa';
const SARE_COLOR = '#a78bfa';

export function CompanyViewsLine({
  data,
  totalReach,
  ugc,
}: {
  data: CompanyViewsRow[];
  totalReach: TotalReachResult;
  ugc: { tips: UgcHeadline; sare: UgcHeadline };
}) {
  const [mode, setMode] = useState<Mode>('owned');
  const [smoothing, setSmoothing] = useState<MASmoothing>('7d');
  const [totalCompany, setTotalCompany] = useState<TotalCompany>('TIPSMUSIC');

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

  // Total-mode rows: mid lines + [low, high] band tuples per company (Recharts
  // renders a range area when the dataKey value is a 2-element array).
  const totalRows = useMemo(
    () =>
      totalReach.weeks.map((w) => ({
        week: w.week,
        tips_mid: w.tips_mid,
        tips_band:
          w.tips_low != null && w.tips_high != null ? [w.tips_low, w.tips_high] : null,
        sare_mid: w.sare_mid,
        sare_band:
          w.sare_low != null && w.sare_high != null ? [w.sare_low, w.sare_high] : null,
      })),
    [totalReach],
  );

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
          <h3 className="text-foreground text-sm font-medium">
            {mode === 'owned'
              ? 'Daily views — Tips vs Saregama'
              : 'Total reach (weekly) — owned + topic'}
          </h3>
          <p className="text-muted-foreground text-xs">
            {mode === 'owned'
              ? `Owned channels per company${smoothing !== 'abs' ? ` · smoothed (${smoothing.toUpperCase()})` : ' · raw daily'}`
              : 'Owned (exact) + Topic/OAC (attributed) · weekly · band = attribution uncertainty · UGC shown separately below'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1">
            {(['owned', 'total'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md border px-2.5 py-1 transition-colors ${
                  mode === m
                    ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                }`}
              >
                {m === 'owned' ? 'Owned (daily)' : 'Total reach (weekly)'}
              </button>
            ))}
          </div>
          {mode === 'owned' &&
            MA_OPTIONS.map((opt) => (
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
          {mode === 'total' &&
            (['TIPSMUSIC', 'SAREGAMA', 'both'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setTotalCompany(c)}
                className={`rounded-md border px-2.5 py-1 transition-colors ${
                  totalCompany === c
                    ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                }`}
              >
                {c === 'TIPSMUSIC' ? 'Tips' : c === 'SAREGAMA' ? 'Saregama' : 'Both'}
              </button>
            ))}
        </div>
      </header>

      {mode === 'owned' ? (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={smoothed} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 11 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => abbrev(v)} />
            <Tooltip
              contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
              labelStyle={{ color: '#cbd5e1' }}
              formatter={(v: number) => v?.toLocaleString?.() ?? String(v)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="tipsmusic" name={`Tips ${smoothing !== 'abs' ? `(${smoothing.toUpperCase()})` : ''}`} stroke={TIPS_COLOR} strokeWidth={1.5} dot={false} connectNulls />
            <Line type="monotone" dataKey="saregama" name={`Saregama ${smoothing !== 'abs' ? `(${smoothing.toUpperCase()})` : ''}`} stroke={SARE_COLOR} strokeWidth={1.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={totalRows} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="week" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} tickFormatter={(v) => abbrev(v)} />
              <Tooltip
                contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6 }}
                labelStyle={{ color: '#cbd5e1' }}
                formatter={(v: number | number[], name: string) =>
                  Array.isArray(v)
                    ? [`${abbrev(v[0])}–${abbrev(v[1])}`, name]
                    : [v?.toLocaleString?.() ?? String(v), name]
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {coverageShade(totalReach, totalCompany)}
              {totalCompany === 'TIPSMUSIC' && (
                <Area type="monotone" dataKey="tips_band" name="Tips band" stroke="none" fill={TIPS_COLOR} fillOpacity={0.15} connectNulls isAnimationActive={false} />
              )}
              {(totalCompany === 'TIPSMUSIC' || totalCompany === 'both') && (
                <Line type="monotone" dataKey="tips_mid" name="Tips total" stroke={TIPS_COLOR} strokeWidth={1.5} dot={false} connectNulls />
              )}
              {totalCompany === 'SAREGAMA' && (
                <Area type="monotone" dataKey="sare_band" name="Saregama band" stroke="none" fill={SARE_COLOR} fillOpacity={0.15} connectNulls isAnimationActive={false} />
              )}
              {(totalCompany === 'SAREGAMA' || totalCompany === 'both') && (
                <Line type="monotone" dataKey="sare_mid" name="Saregama total" stroke={SARE_COLOR} strokeWidth={1.5} dot={false} connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <UgcStrip ugc={ugc} totalReach={totalReach} />
        </>
      )}
      <RepairNote data={data} />
    </div>
  );
}

/**
 * Flags when the plotted window contains days whose per-day value was inferred.
 *
 * YouTube sometimes serves a stale cumulative viewCount for several days; the
 * backlog is then spread back across the days it covered, so the period total
 * is right but those points are interpolated. A smoothed line must not read as
 * measured — see /ops -> Data quality for the affected dates.
 */
function RepairNote({ data }: { data: CompanyViewsRow[] }) {
  const affected = data.filter((d) => (d.imputed ?? 0) > 0);
  if (affected.length === 0) return null;
  const first = affected[0].date;
  const last = affected[affected.length - 1].date;
  const range = first === last ? first : `${first} – ${last}`;
  return (
    <p className="text-muted-foreground/70 mt-2 text-[11px]">
      ⓘ {affected.length} day{affected.length === 1 ? '' : 's'} in this window ({range})
      {' '}had their per-day split inferred after YouTube served a stale cumulative count.
      Totals are exact; the daily shape across those days is interpolated. See Ops → Data
      quality.
    </p>
  );
}

/** Shade the window before topic tracking began (single-company mode only) so
 * the topic step-up isn't misread as a real jump in reach. */
function coverageShade(totalReach: TotalReachResult, totalCompany: TotalCompany) {
  if (totalCompany === 'both' || !totalReach.weeks.length) return null;
  const start =
    totalCompany === 'TIPSMUSIC'
      ? totalReach.tips.topic_coverage_start
      : totalReach.saregama.topic_coverage_start;
  const firstWeek = totalReach.weeks[0].week;
  if (!start || firstWeek >= start) return null;
  return (
    <ReferenceArea
      x1={firstWeek}
      x2={start}
      fill="rgba(255,255,255,0.05)"
      stroke="none"
      label={{ value: 'owned only (topic not yet tracked)', position: 'insideTop', fontSize: 10, fill: '#64748b' }}
    />
  );
}

function UgcStrip({
  ugc,
  totalReach,
}: {
  ugc: { tips: UgcHeadline; sare: UgcHeadline };
  totalReach: TotalReachResult;
}) {
  return (
    <div className="border-border mt-3 rounded-md border border-dashed p-3 text-xs">
      <div className="text-foreground mb-1 font-medium">
        UGC discovered reach — cumulative, sampled lower bound (not in the line above)
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span style={{ color: TIPS_COLOR }}>
          Tips ≈ {abbrev(ugc.tips.attributed_views)} across {ugc.tips.ugc_shorts_count.toLocaleString()} shorts · grade {ugc.tips.grade}
        </span>
        <span style={{ color: SARE_COLOR }}>
          Saregama ≈ {abbrev(ugc.sare.attributed_views)} across {ugc.sare.ugc_shorts_count.toLocaleString()} shorts · grade {ugc.sare.grade}
        </span>
      </div>
      <p className="text-muted-foreground mt-1">
        Third-party Shorts using catalog audio (videos.list-exact where resolved, else approximate). Discovered via the
        Shorts source-pivot — a sampled subset, so a lower bound. Band on the line = Tips {totalReach.tips.grade} /
        Saregama {totalReach.saregama.grade} confidence.
      </p>
    </div>
  );
}

function abbrev(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
