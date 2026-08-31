'use client';

import { useState } from 'react';
import type { LagCorrelationSet } from '@/lib/queries';
import { METRIC_LABEL } from '@/lib/metrics';
import { INK, NEUTRAL, seriesColor } from '@/lib/chart-palette';

const PW = 360;
const PH = 150;
const ZERO = 75;
const SCALE = 200; // px per 1.0 of r

/**
 * Metric-vs-price correlation at each lag, for every metric and company.
 *
 * Presented as a grid on one shared scale so the comparison is honest, and with
 * the significance threshold drawn — because the finding here is that almost
 * nothing crosses it, which only reads if the line is visible.
 */
export function LagCorrelationGrid({ sets }: { sets: LagCorrelationSet[] }) {
  const [showSig, setShowSig] = useState(true);
  const companies = [...new Set(sets.map((s) => s.company))].sort();
  const metrics = ['views', 'subscribers', 'releases'] as const;

  const total = sets.reduce((a, s) => a + s.lags.filter((l) => l.r != null).length, 0);
  const hits = sets.reduce((a, s) => a + s.nominallySignificant, 0);
  const expected = total * 0.05;

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">
            What moves the share price?
          </h3>
          <p className="text-muted-foreground text-xs">
            each metric against daily log returns, lags −7 to +7 · metric leads ← · → price leads
          </p>
          <p className="text-muted-foreground/80 mt-0.5 text-[11px]">
            bars above the baseline are positive r, below it negative · dashed rule = 5%
            significance · faded bars fall short of it
          </p>
        </div>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs select-none">
          <input
            type="checkbox"
            checked={showSig}
            onChange={(e) => setShowSig(e.target.checked)}
            className="accent-blue-500"
          />
          Significance
        </label>
      </header>

      {companies.map((company) => (
        <div key={company} className="mb-4">
          <div className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider">
            {company}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {metrics.map((metric) => {
              const set = sets.find((s) => s.company === company && s.metric === metric);
              if (!set) return null;
              return (
                <div key={metric} className="border-border/40 rounded-md border p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-foreground text-xs font-medium">
                      {METRIC_LABEL[metric]}
                    </span>
                    <span className="text-muted-foreground text-[10px] tabular-nums">
                      {set.best
                        ? `best ${set.best.r >= 0 ? '+' : ''}${set.best.r.toFixed(3)} @ ${set.best.lag >= 0 ? '+' : ''}${set.best.lag}`
                        : 'no data'}
                    </span>
                  </div>
                  <svg viewBox={`0 0 ${PW} ${PH}`} className="mt-2 block h-[150px] w-full">
                    {showSig ? (
                      <>
                        <line x1={0} x2={PW} y1={ZERO - set.critical * SCALE} y2={ZERO - set.critical * SCALE} stroke={NEUTRAL} strokeDasharray="4 3" />
                        <line x1={0} x2={PW} y1={ZERO + set.critical * SCALE} y2={ZERO + set.critical * SCALE} stroke={NEUTRAL} strokeDasharray="4 3" />
                      </>
                    ) : null}
                    {set.lags.map((l, i) => {
                      if (l.r == null) return null;
                      const h = Math.max(1, Math.abs(l.r) * SCALE);
                      const sig = Math.abs(l.r) > set.critical;
                      return (
                        <rect
                          key={l.lag}
                          x={i * (PW / set.lags.length) + 4}
                          y={l.r > 0 ? ZERO - h : ZERO}
                          width={PW / set.lags.length - 8}
                          height={h}
                          rx={2}
                          fill={l.r > 0 ? seriesColor(0) : seriesColor(1)}
                          opacity={sig ? 1 : 0.55}
                        />
                      );
                    })}
                    <line x1={0} x2={PW} y1={ZERO} y2={ZERO} stroke={INK} />
                  </svg>
                  <div className="text-muted-foreground/60 mt-1 flex justify-between font-mono text-[9px]">
                    <span>−7</span><span>0</span><span>+7</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-muted-foreground/80 border-border/60 mt-3 border-t pt-3 text-[11px] leading-relaxed">
        <span className="text-foreground">
          {hits} of {total} tests clear the 5% line; chance alone predicts {expected.toFixed(1)}.
        </span>{' '}
        Correlations use daily log returns, not price levels — two trending series correlate
        with almost anything, and that artefact is the most common way this analysis is got
        wrong. Adjacent lags are autocorrelated, so neighbouring bars are not independent
        evidence.
      </p>
    </div>
  );
}
