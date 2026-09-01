import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getCorrelationMatrix,
  getDataQuality,
  getExplorerRows,
  getLagCorrelations,
  type DataQualitySnapshot,
  type LagCorrelationSet,
} from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { Card, CardHead, Disclose, Section, Shell } from '@/components/shell/app-shell';
import { ExplorerTable } from '@/components/explore/explorer-table';
import { CorrelationMatrix } from '@/components/evidence/correlation-matrix';

/**
 * Evidence — does the claim survive?
 *
 * The design frames this tab as a falsification exercise rather than a
 * showcase: the correlation is scanned across several windows, the windows that
 * fail are shown failing, and what would break the thesis is written down.
 */
export default async function EvidencePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <Shell>
      <Section id="correlation" className="flex flex-col gap-gap">
        <Card className="p-pad">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.02em]">
            Does reach actually lead the price?
          </h1>
          <p className="text-muted-foreground m-0 mt-2 max-w-[80ch] text-[13px]">
            Correlation of log daily-view change against log return, scanned across every lag in the
            window. The claim is only as strong as the number of windows where it survives — so the
            windows where it does not are shown too.
          </p>
        </Card>
        <Card className="overflow-hidden">
          <CardHead
            title="Reach vs price — every pair"
            note="Each metric against BOTH share prices. Same-company cells are the claim; cross-company cells are the control."
          />
          <Suspense fallback={<Block h={520} bare />}>
            <Matrix />
          </Suspense>
        </Card>
        <Suspense fallback={<Block h={300} />}>
          <Windows />
        </Suspense>
      </Section>

      <Section id="data">
        <Card className="overflow-hidden">
          <CardHead
            title="Raw series"
            note="The daily grain everything above is computed from — slice, aggregate, compare and export it"
          />
          <Suspense fallback={<Block h={420} bare />}>
            <RawSeries />
          </Suspense>
        </Card>
      </Section>

      <Section id="coverage" className="flex flex-col gap-gap">
        <Suspense fallback={<Block h={140} />}>
          <Coverage />
        </Suspense>
      </Section>

      <Section id="method">
        <Card className="p-pad">
          <h2 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-eyebrow">Method</h2>
          <div className="flex flex-col gap-3">
            <Disclose summary="What would falsify the lead-lag claim">
              Two consecutive 30-day windows below the significance floor at every lag, or the best
              lag moving outside the +2d to +6d band. A long window that sits below the floor is
              already a partial falsification, which is why a read is never framed on the full
              history alone.
            </Disclose>
            <Disclose summary="Why lags are scanned rather than picked">
              Fifteen lags are tested, so at a nominal 5% threshold roughly one will clear by chance
              about half the time. A single clearing lag is therefore weak evidence; the count of
              clearing lags is reported beside it so a lucky one cannot be mistaken for a result.
            </Disclose>
            <Disclose summary="How repaired days are treated">
              YouTube intermittently serves a stale cumulative view count. When it unfreezes, the
              backlog is spread back across the days it covered, so period totals stay exact while
              individual days are interpolated. Those days are counted in Coverage above and are
              never presented as measured.
            </Disclose>
            <Disclose summary="Why correlation is computed on changes, not levels">
              Two series that both trend upward correlate near 1 on levels whether or not they are
              related. Log changes ask the question that matters: do they move together day to day?
            </Disclose>
          </div>
        </Card>
      </Section>
    </Shell>
  );
}

async function Matrix() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation, CACHE_TAGS.stock, CACHE_TAGS.channels);

  const result = await getCorrelationMatrix({ days: 365 });
  return <CorrelationMatrix result={result} />;
}

async function Windows() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);

  // Three windows so a claim that only holds on one is visibly fragile.
  const [short, mid, long] = await Promise.all([
    getLagCorrelations({ days: 30 }),
    getLagCorrelations({ days: 90 }),
    getLagCorrelations({ days: 365 }),
  ]);

  const rows = [
    ...short.map((s) => ({ window: '30d', set: s })),
    ...mid.map((s) => ({ window: '90d', set: s })),
    ...long.map((s) => ({ window: '365d', set: s })),
  ];

  return <WindowsTable rows={rows} />;
}

function WindowsTable({ rows }: { rows: Array<{ window: string; set: LagCorrelationSet }> }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left font-mono text-[10px] uppercase tracking-eyebrow">
              <th className="px-pad py-2.5 font-medium">Window</th>
              <th className="px-3.5 py-2.5 font-medium">Company</th>
              <th className="px-3.5 py-2.5 text-right font-medium">Best lag</th>
              <th className="px-3.5 py-2.5 text-right font-medium">r</th>
              <th className="px-3.5 py-2.5 text-right font-medium">crit r</th>
              <th className="px-3.5 py-2.5 text-right font-medium">n</th>
              <th className="px-pad py-2.5 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ window, set }, i) => {
              const best = set.best;
              const holds = best != null && Math.abs(best.r) >= set.critical;
              const n = set.lags[0]?.n ?? 0;
              return (
                <tr
                  key={`${window}-${set.company}`}
                  className={i < rows.length - 1 ? 'border-border border-b' : ''}
                >
                  <td className="px-pad py-row font-mono text-xs">{window}</td>
                  <td className="px-3.5 py-row">{set.company}</td>
                  <td className="px-3.5 py-row text-right font-mono text-xs">
                    {best == null ? '—' : `${best.lag >= 0 ? '+' : ''}${best.lag}d`}
                  </td>
                  <td
                    className={`px-3.5 py-row text-right font-mono text-xs ${
                      best == null ? 'text-muted-foreground' : holds ? 'text-good' : 'text-warn'
                    }`}
                  >
                    {best == null ? '—' : best.r.toFixed(2)}
                  </td>
                  <td className="text-muted-foreground px-3.5 py-row text-right font-mono text-xs">
                    {set.critical.toFixed(2)}
                  </td>
                  <td className="text-muted-foreground px-3.5 py-row text-right font-mono text-xs">
                    {n === 0 ? '—' : n}
                  </td>
                  <td className="px-pad py-row text-xs">
                    {best == null ? (
                      <span className="text-muted-foreground">not computed</span>
                    ) : holds ? (
                      <span className="text-good">✓ holds</span>
                    ) : (
                      <span className="text-warn">⚠ below floor</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function Coverage() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.channels);

  const dq = await getDataQuality({ days: 90 });
  return <CoverageCards dq={dq} />;
}

function CoverageCards({ dq }: { dq: DataQualitySnapshot }) {
  const totalDays = dq.days.length;
  const affected = dq.days.filter((d) => d.channels_affected > 0).length;
  const clean = totalDays > 0 ? ((totalDays - affected) / totalDays) * 100 : null;

  const cards = [
    {
      label: 'Days of history',
      value: totalDays === 0 ? '—' : String(totalDays),
      note: `in the ${90}-day quality window`,
    },
    {
      label: 'Days fully measured',
      value: clean == null ? '—' : `${clean.toFixed(1)}%`,
      note: `${dq.imputed_channel_days} channel-days interpolated`,
    },
    {
      label: 'Frozen right now',
      value: String(dq.unresolved_channels),
      note:
        dq.unresolved_channels === 0
          ? 'every channel reporting'
          : 'awaiting the next good reading',
    },
  ];

  return (
    <div className="grid gap-gap sm:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label} className="p-pad">
          <p className="text-muted-foreground m-0 font-mono text-[11px] uppercase tracking-[0.08em]">
            {c.label}
          </p>
          <p className="m-0 mt-2 text-[26px] font-semibold tracking-[-0.02em]">{c.value}</p>
          <p className="text-muted-foreground m-0 mt-1 text-xs">{c.note}</p>
        </Card>
      ))}
    </div>
  );
}

async function RawSeries() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels, CACHE_TAGS.overview);

  const rows = await getExplorerRows({});
  return <ExplorerTable rows={rows} />;
}

function Block({ h, bare = false }: { h: number; bare?: boolean }) {
  return (
    <div
      className={`bg-surface2/50 animate-pulse ${bare ? '' : 'border-border rounded-card border'}`}
      style={{ height: h }}
    />
  );
}
