'use client';

import { useState } from 'react';
import type { MatrixCell, MatrixResult } from '@/lib/correlation-matrix';
import { METRIC_LABEL, type ExplorerMetric } from '@/lib/metrics';
import { divergingFill, divergingInk } from '@/lib/chart-palette';

const METRIC_ORDER: ExplorerMetric[] = ['views', 'subscribers', 'releases'];
const SHORT: Record<string, string> = { TIPSMUSIC: 'TIPS', SAREGAMA: 'SARE' };

const key = (c: MatrixCell) => `${c.source}|${c.metric}|${c.priceSymbol}`;

/**
 * Reach against price, every pair at once.
 *
 * Reading order is deliberate. The number is in every cell, so identity never
 * rests on the fill; the fill carries magnitude and sign; a cell that survives
 * the correction gets a ring AND a glyph, because a border alone is a second
 * colour cue and a glyph is not. Same-company columns are the claim,
 * cross-company are the control, and they are labelled as such rather than left
 * for the reader to infer from the header.
 */
export function CorrelationMatrix({ result }: { result: MatrixResult }) {
  const companies = [...new Set(result.cells.map((c) => c.source))].sort();
  const symbols = [...new Set(result.cells.map((c) => c.priceSymbol))].sort();
  const byKey = new Map(result.cells.map((c) => [key(c), c]));

  const firstTestable = result.cells.find((c) => c.best != null) ?? result.cells[0] ?? null;
  const [selected, setSelected] = useState<string | null>(
    firstTestable ? key(firstTestable) : null,
  );
  const active = selected ? (byKey.get(selected) ?? null) : null;

  const rows = companies.flatMap((company) =>
    METRIC_ORDER.map((metric) => ({ company, metric })),
  );

  return (
    <div>
      {/* The headline is the scan size, not a finding. Put it first so nobody
          reads a cell before knowing how many tests produced it. */}
      <div className="border-border grid gap-px border-b bg-border sm:grid-cols-4">
        <Stat label="Tests run" value={String(result.testsRun)} note={`${result.lagsScanned} lags × ${result.cells.length} pairs`} />
        <Stat
          label="Expected by chance"
          value={result.expectedByChance.toFixed(1)}
          note={`at α=${result.alpha}, uncorrected`}
        />
        <Stat
          label="Clear uncorrected"
          value={String(result.nominallySignificant)}
          note="before any correction"
          tone={result.nominallySignificant > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Survive FDR"
          value={String(result.survivingFdr)}
          note="Benjamini–Hochberg"
          tone={result.survivingFdr > 0 ? 'good' : undefined}
        />
      </div>

      <div className="overflow-x-auto p-pad">
        <table className="w-full border-collapse text-[13px]">
          <caption className="text-muted-foreground mb-3 text-left text-xs">
            Strongest correlation across lags −7…+7. Positive lag means reach leads price.
          </caption>
          <thead>
            <tr>
              <th className="text-muted-foreground w-[190px] px-2 py-2 text-left font-mono text-[10px] uppercase tracking-eyebrow font-medium">
                Reach metric
              </th>
              {symbols.map((sym) => (
                <th
                  key={sym}
                  className="text-muted-foreground px-2 py-2 text-center font-mono text-[10px] uppercase tracking-eyebrow font-medium"
                >
                  {SHORT[sym] ?? sym} price
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ company, metric }, i) => (
              <tr key={`${company}-${metric}`} className={i > 0 && metric === 'views' ? 'border-border border-t' : ''}>
                <th
                  scope="row"
                  className="px-2 py-1.5 text-left text-[12px] font-normal"
                >
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {SHORT[company] ?? company}
                  </span>{' '}
                  <span className="text-ink2">{METRIC_LABEL[metric]}</span>
                </th>
                {symbols.map((sym) => {
                  const cell = byKey.get(`${company}|${metric}|${sym}`);
                  return (
                    <td key={sym} className="px-1 py-1">
                      {cell ? (
                        <Cell
                          cell={cell}
                          selected={selected === key(cell)}
                          onSelect={() => setSelected(key(cell))}
                        />
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <Legend />
      </div>

      {active ? <LagProfile cell={active} /> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <div className="bg-surface px-pad py-3">
      <div className="text-muted-foreground font-mono text-[10px] uppercase tracking-eyebrow">
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-semibold ${tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : ''}`}
      >
        {value}
      </div>
      <div className="text-muted-foreground mt-0.5 text-[11px]">{note}</div>
    </div>
  );
}

function Cell({
  cell,
  selected,
  onSelect,
}: {
  cell: MatrixCell;
  selected: boolean;
  onSelect: () => void;
}) {
  const r = cell.best?.r ?? null;
  const claim = cell.sameCompany;

  const title = [
    `${cell.source} ${METRIC_LABEL[cell.metric]} vs ${cell.priceSymbol} price`,
    claim ? 'same company — the claim' : 'cross company — the control',
    r == null
      ? 'Not measurable in this window'
      : `r = ${r.toFixed(3)} at lag ${cell.best!.lag >= 0 ? '+' : ''}${cell.best!.lag}d`,
    r == null ? '' : `n = ${cell.n}, effective n = ${cell.nEffective}`,
    cell.q == null ? '' : `q = ${cell.q.toFixed(3)} after correction`,
    cell.significant ? 'Survives FDR' : r == null ? '' : 'Does not survive FDR',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      aria-label={title.replace(/\n/g, '. ')}
      aria-pressed={selected}
      className={`relative flex h-14 w-full items-center justify-center rounded-md border transition-colors ${
        selected ? 'border-accent' : 'border-transparent hover:border-border2'
      } ${claim ? '' : 'opacity-90'}`}
      style={{ background: divergingFill(r) }}
    >
      {r == null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        <span className="font-mono text-[15px]" style={{ color: divergingInk(r) }}>
          {r >= 0 ? '+' : '−'}
          {Math.abs(r).toFixed(2)}
        </span>
      )}
      {/* Significance carries a glyph, not just a ring — a ring is another
          colour cue and this must survive being read in greyscale. */}
      {cell.significant ? (
        <span
          className="text-good absolute right-1 top-0.5 text-[10px]"
          aria-hidden
          title="survives FDR"
        >
          ✓
        </span>
      ) : null}
      {r != null ? (
        <span className="text-muted-foreground absolute bottom-0.5 right-1.5 font-mono text-[9px]">
          {cell.best!.lag >= 0 ? '+' : ''}
          {cell.best!.lag}d
        </span>
      ) : null}
      {!claim ? (
        <span className="text-muted-foreground absolute left-1.5 top-0.5 text-[9px]" aria-hidden>
          ctl
        </span>
      ) : null}
    </button>
  );
}

function Legend() {
  const steps = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[10px]">−1</span>
        <div className="flex">
          {steps.map((s) => (
            <span
              key={s}
              className="border-border h-3.5 w-7 border-y first:rounded-l first:border-l last:rounded-r last:border-r"
              style={{ background: divergingFill(s === 0 ? null : s) }}
            />
          ))}
        </div>
        <span className="text-muted-foreground font-mono text-[10px]">+1</span>
      </div>
      <span className="text-muted-foreground text-[11px]">
        <span className="text-good">✓</span> survives correction · <span className="font-mono">ctl</span> = cross-company control · unfilled = near zero
      </span>
    </div>
  );
}

/**
 * The selected pair across every lag.
 *
 * A single r hides whether the relationship is a peak or a plateau, and a
 * plateau across all lags usually means both series share a trend rather than
 * one leading the other.
 */
function LagProfile({ cell }: { cell: MatrixCell }) {
  const W = 720;
  const H = 150;
  const base = 100;
  const usable = cell.lags.filter((l) => l.r != null);
  const maxR = Math.max(...usable.map((l) => Math.abs(l.r as number)), cell.critical ?? 0.2, 0.15);
  const barW = Math.max(8, Math.floor((W - 60) / Math.max(cell.lags.length, 1)) - 5);
  const h = (r: number) => (Math.abs(r) / maxR) * 62;
  const critY = cell.critical == null ? null : base - (cell.critical / maxR) * 62;

  return (
    <div className="border-border border-t p-pad">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-[13px] font-semibold uppercase tracking-eyebrow">
          {SHORT[cell.source] ?? cell.source} {METRIC_LABEL[cell.metric]} → {SHORT[cell.priceSymbol] ?? cell.priceSymbol} price
        </h3>
        <span className="text-muted-foreground font-mono text-[11px]">
          {cell.sameCompany ? 'same company · the claim' : 'cross company · the control'}
        </span>
      </div>

      {usable.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Not enough paired observations in this window to scan lags for this pair.
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
            <line x1={30} y1={base} x2={W - 10} y2={base} stroke="rgb(var(--border2))" />
            {critY != null ? (
              <>
                <line x1={30} y1={critY} x2={W - 10} y2={critY} stroke="rgb(var(--gridline))" strokeDasharray="3 3" />
                <line x1={30} y1={base + (base - critY)} x2={W - 10} y2={base + (base - critY)} stroke="rgb(var(--gridline))" strokeDasharray="3 3" />
                <text x={32} y={critY - 4} fill="rgb(var(--muted))" fontSize={9} fontFamily="var(--font-mono)">
                  ±{cell.critical!.toFixed(2)} uncorrected
                </text>
              </>
            ) : null}
            {cell.lags.map((l, i) => {
              const r = l.r;
              const x = 34 + i * (barW + 5);
              if (r == null) {
                return (
                  <text key={l.lag} x={x + barW / 2} y={base - 4} fill="rgb(var(--muted))" fontSize={10} textAnchor="middle">
                    —
                  </text>
                );
              }
              const isBest = cell.best != null && l.lag === cell.best.lag;
              return (
                <rect
                  key={l.lag}
                  x={x}
                  y={r >= 0 ? base - h(r) : base}
                  width={barW}
                  height={Math.max(1, h(r))}
                  rx={2}
                  fill={divergingFill(r)}
                  stroke={isBest ? 'rgb(var(--accent))' : 'transparent'}
                  strokeWidth={isBest ? 1.5 : 0}
                >
                  <title>{`lag ${l.lag >= 0 ? '+' : ''}${l.lag}d · r = ${r.toFixed(3)} · n = ${l.n}`}</title>
                </rect>
              );
            })}
            {cell.lags.map((l, i) =>
              l.lag % 2 === 0 ? (
                <text
                  key={`x${l.lag}`}
                  x={34 + i * (barW + 5) + barW / 2}
                  y={H - 6}
                  fill="rgb(var(--muted))"
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {l.lag >= 0 ? `+${l.lag}` : l.lag}
                </text>
              ) : null,
            )}
          </svg>

          <p className="text-ink2 m-0 mt-2 max-w-[92ch] text-xs leading-relaxed">
            <strong className="font-semibold">Positive lag means reach leads price.</strong>{' '}
            {cell.best == null ? (
              'No lag is measurable here.'
            ) : (
              <>
                Strongest at {cell.best.lag >= 0 ? '+' : ''}
                {cell.best.lag}d, r = {cell.best.r.toFixed(3)} on {cell.n} paired days
                {cell.nEffective < cell.n
                  ? ` (${cell.nEffective} effective, after adjusting for autocorrelation)`
                  : ''}
                . {cell.q != null ? `q = ${cell.q.toFixed(3)} once every test in the grid is corrected together — ` : ''}
                {cell.significant
                  ? 'this survives the correction.'
                  : 'this does not survive the correction, so it is not evidence of a relationship.'}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
