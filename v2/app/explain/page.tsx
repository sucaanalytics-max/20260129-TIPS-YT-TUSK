import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  getChannelGrowth,
  getChannelLeaderboard,
  getLagCorrelations,
  getLanguageRollup,
  type ChannelGrowthRow,
  type LagCorrelationSet,
} from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { Card, CardHead, Disclose, Section, Shell } from '@/components/shell/app-shell';
import { ChannelLeaderboard } from '@/components/breakdowns/channel-leaderboard';

const compact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '+';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M/d`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k/d`;
  return `${s}${a.toFixed(0)}/d`;
};

/**
 * Explain — what carried the move.
 *
 * Decomposes the group view delta by channel, then shows whether that reach
 * relates to the price at all. The second half is what keeps the first half
 * honest: an attribution chart is only interesting if reach and price are
 * connected, and the lead-lag panel is where that claim is tested rather than
 * assumed.
 */
export default async function ExplainPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <Shell>
      <Section id="attribution" className="grid items-start gap-gap lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Suspense fallback={<Block h={420} />}>
          <Attribution />
        </Suspense>
        <Section id="lead-lag">
          <Suspense fallback={<Block h={340} />}>
            <LeadLag />
          </Suspense>
        </Section>
      </Section>

      <Section id="channels">
        <Card className="overflow-hidden">
          <CardHead title="Channels" note="Every owned channel, sorted by daily views" />
          <Suspense fallback={<Block h={360} bare />}>
            <Channels />
          </Suspense>
        </Card>
      </Section>

      <Section id="catalogue">
        <Suspense fallback={<Block h={260} />}>
          <Catalogue />
        </Suspense>
      </Section>
    </Shell>
  );
}

async function Attribution() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels, CACHE_TAGS.overview);

  const rows = await getChannelGrowth({ company: 'TIPSMUSIC' });
  return <AttributionCard rows={rows} />;
}

/**
 * Contribution to the 30-day view delta, per channel.
 *
 * Bars are scaled against the largest ABSOLUTE contribution so a big negative
 * reads as visually equal to a big positive; scaling to the maximum positive
 * would make declines look smaller than they are.
 */
function AttributionCard({ rows }: { rows: ChannelGrowthRow[] }) {
  const contrib = rows
    .map((r) => ({
      name: r.channel_name,
      delta: r.avg_30d != null && r.avg_90d != null ? r.avg_30d - r.avg_90d : null,
    }))
    .filter((c): c is { name: string; delta: number } => c.delta != null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const top = contrib.slice(0, 5);
  const tail = contrib.slice(5);
  const tailSum = tail.reduce((a, c) => a + c.delta, 0);
  const max = Math.max(...contrib.map((c) => Math.abs(c.delta)), 1);

  const items = [
    ...top,
    ...(tail.length > 0 ? [{ name: `Remaining ${tail.length} channels`, delta: tailSum }] : []),
  ];

  return (
    <Card>
      <CardHead title="Contribution to Δ views · 30d vs 90d" />
      {items.length === 0 ? (
        <p className="text-muted-foreground p-pad text-sm">
          Not enough channel history to decompose the move yet.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-pad">
          {items.map((c, i) => {
            const isTail = i === items.length - 1 && tail.length > 0;
            const colour = isTail
              ? 'rgb(var(--muted))'
              : c.delta >= 0
                ? 'rgb(var(--tips))'
                : 'rgb(var(--bad))';
            return (
              <li
                key={c.name}
                className="grid items-center gap-3.5"
                style={{ gridTemplateColumns: 'minmax(0,1fr) 84px' }}
              >
                <span>
                  <span className="mb-1.5 block truncate text-[13px] font-medium">{c.name}</span>
                  <span className="bg-gridline block h-2 rounded-sm">
                    <span
                      className="block h-2 rounded-sm"
                      style={{ width: `${(Math.abs(c.delta) / max) * 100}%`, background: colour }}
                    />
                  </span>
                </span>
                <span
                  className={`text-right font-mono text-xs ${
                    isTail ? 'text-muted-foreground' : c.delta >= 0 ? 'text-good' : 'text-bad'
                  }`}
                >
                  {compact(c.delta)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Disclose summary="Method" className="border-border border-t px-pad py-4">
        Each channel&rsquo;s trailing 30-day mean daily views minus its own trailing 90-day mean, so
        a channel is measured against itself rather than against the group. Repaired channel-days
        are included at their interpolated split and are counted in Evidence · Coverage.
      </Disclose>
    </Card>
  );
}

async function LeadLag() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.correlation);

  const sets = await getLagCorrelations({ days: 110 });
  const set = sets.find((s) => s.company === 'TIPSMUSIC') ?? sets[0] ?? null;
  return <LeadLagCard set={set} />;
}

/**
 * Correlation of reach against price at every lag.
 *
 * Significance is encoded by FILL plus an explicit label, never by colour
 * alone, and the direction convention is stated on the card. Getting that
 * convention backwards would invert the entire claim the dashboard exists to
 * make, so it is written down rather than left to be inferred from the axis.
 */
function LeadLagCard({ set }: { set: LagCorrelationSet | null }) {
  if (!set || set.lags.length === 0) {
    return (
      <Card>
        <CardHead title="Lead-lag" />
        <p className="text-muted-foreground p-pad text-sm">
          Not enough paired days to scan lags in this window.
        </p>
      </Card>
    );
  }

  const W = 340;
  const H = 170;
  const base = 120;
  const maxR = Math.max(...set.lags.map((l) => Math.abs(l.r ?? 0)), set.critical, 0.1);
  const barW = Math.max(6, Math.floor((W - 40) / set.lags.length) - 4);
  const scale = (r: number) => (Math.abs(r) / maxR) * 74;
  const critY = base - (set.critical / maxR) * 74;

  return (
    <Card>
      <CardHead title="Lead-lag" note={`TIPSMUSIC · n=${set.lags[0]?.n ?? 0}`} />
      <div className="p-pad">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
          <line x1={20} y1={base} x2={W - 10} y2={base} stroke="rgb(var(--border2))" />
          <line x1={20} y1={critY} x2={W - 10} y2={critY} stroke="rgb(var(--gridline))" strokeDasharray="3 3" />
          <text x={24} y={critY - 3} fill="rgb(var(--muted))" fontSize={9} fontFamily="var(--font-mono)">
            sig {set.critical.toFixed(2)}
          </text>
          {set.lags.map((l, i) => {
            const r = l.r ?? 0;
            const h = scale(r);
            const x = 24 + i * (barW + 4);
            const sig = Math.abs(r) >= set.critical;
            const isBest = set.best != null && l.lag === set.best.lag;
            return (
              <g key={l.lag}>
                <rect
                  x={x}
                  y={r >= 0 ? base - h : base}
                  width={barW}
                  height={Math.max(1, h)}
                  fill={sig ? 'rgb(var(--accent))' : 'rgb(var(--muted))'}
                  opacity={sig ? 1 : 0.55}
                />
                {isBest && l.r != null ? (
                  <text
                    x={x + barW / 2}
                    y={(r >= 0 ? base - h : base + h) - 5}
                    fill="rgb(var(--accent))"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {l.r.toFixed(2)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text x={20} y={H - 30} fill="rgb(var(--muted))" fontSize={10} fontFamily="var(--font-mono)">
            {set.lags[0]?.lag}d
          </text>
          <text x={W - 34} y={H - 30} fill="rgb(var(--muted))" fontSize={10} fontFamily="var(--font-mono)">
            +{set.lags[set.lags.length - 1]?.lag}d
          </text>
        </svg>

        <p className="text-ink2 m-0 mt-2.5 text-xs leading-relaxed">
          <strong className="font-semibold">Positive lag means views lead price.</strong>{' '}
          {set.best == null ? (
            <>No lag clears the significance floor of {set.critical.toFixed(2)}, so every bar is drawn neutral and nothing here supports a lead-lag claim.</>
          ) : (
            <>
              Best at {set.best.lag >= 0 ? '+' : ''}
              {set.best.lag}d, r = {set.best.r.toFixed(2)}.{' '}
              {set.nominallySignificant === 0
                ? 'No lag clears the floor once significance is applied.'
                : `${set.nominallySignificant} of ${set.lags.length} lags clear the ${set.critical.toFixed(2)} floor before any multiple-comparison correction — scanning fifteen lags will find one by chance about half the time, so treat a single clearing lag as weak.`}
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

async function Channels() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);

  const rows = await getChannelLeaderboard({});
  return <ChannelLeaderboard rows={rows} />;
}

async function Catalogue() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.channels);

  const rows = await getLanguageRollup({});
  const max = Math.max(...rows.map((r) => Number(r.daily_views_7d_avg ?? 0)), 1);

  return (
    <Card>
      <CardHead title="Catalogue by language" note="Mean daily views over the trailing 7 days" />
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-pad text-sm">No language rollup available.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-pad">
          {rows.slice(0, 10).map((r) => (
            <li
              key={`${r.language}`}
              className="grid items-center gap-3.5"
              style={{ gridTemplateColumns: '120px minmax(0,1fr) 90px' }}
            >
              <span className="truncate text-[13px]">{r.language ?? 'Unknown'}</span>
              <span className="bg-gridline block h-2 rounded-sm">
                <span
                  className="bg-tips block h-2 rounded-sm"
                  style={{ width: `${(Number(r.daily_views_7d_avg ?? 0) / max) * 100}%` }}
                />
              </span>
              <span className="text-muted-foreground text-right font-mono text-xs">
                {r.daily_views_7d_avg == null
                  ? '—'
                  : Math.round(Number(r.daily_views_7d_avg)).toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Block({ h, bare = false }: { h: number; bare?: boolean }) {
  return (
    <div
      className={`bg-surface2/50 animate-pulse ${bare ? '' : 'border-border rounded-card border'}`}
      style={{ height: h }}
    />
  );
}
