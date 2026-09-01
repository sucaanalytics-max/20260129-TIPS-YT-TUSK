import { Suspense } from 'react';
import { auth } from '@clerk/nextjs/server';
import { cacheLife, cacheTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { getNowcastHeadline, getReportedFinancials, type NowcastHeadline } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';
import { formatCrore, rupeesToCrore } from '@/lib/financials';
import { Card, CardHead, Disclose, Section, Shell } from '@/components/shell/app-shell';

const LABEL: Record<string, string> = {
  TIPSMUSIC: 'Tips Music',
  SAREGAMA: 'Saregama · music',
};

/**
 * Forecast — the revenue nowcast and the record it is judged on.
 *
 * The design drew this tab assuming a scored model ("✓ scored · 4 quarters",
 * "Hit rate 4/4"). No estimate has ever been checked against a printed result,
 * so those become an explicit unscored state instead. An estimate nobody has
 * verified must not be dressed as one that has been.
 */
export default async function ForecastPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <Shell>
      <Section id="nowcast" className="grid gap-gap lg:grid-cols-2">
        <Suspense fallback={<Block h={300} />}>
          <Estimate company="TIPSMUSIC" />
        </Suspense>
        <Suspense fallback={<Block h={300} />}>
          <Estimate company="SAREGAMA" />
        </Suspense>
      </Section>

      <Section id="filed-actuals">
        <Suspense fallback={<Block h={280} />}>
          <FiledActuals />
        </Suspense>
      </Section>

      <Section id="track-record">
        <Suspense fallback={<Block h={200} />}>
          <TrackRecord />
        </Suspense>
      </Section>
    </Shell>
  );
}

async function Estimate({ company }: { company: 'TIPSMUSIC' | 'SAREGAMA' }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast);

  const asof = new Date().toISOString().slice(0, 10);
  const head = await getNowcastHeadline(company, asof);
  return <EstimateCard head={head} />;
}

function EstimateCard({ head }: { head: NowcastHeadline }) {
  const scored = head.trackRecord.n > 0;
  const pct = Math.round(head.quarterProgress * 100);
  const daysLeft = Math.max(
    0,
    Math.round(
      (Date.parse(`${head.fiscal.end}T00:00:00Z`) - Date.now()) / 86_400_000,
    ),
  );

  return (
    <Card className="p-pad">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[13px] font-semibold uppercase tracking-eyebrow">
          {LABEL[head.company] ?? head.company} · {head.fiscal.label}
        </h2>
        {scored ? (
          <span className="text-good font-mono text-[11px]">
            ✓ scored · {head.trackRecord.n} quarter{head.trackRecord.n === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-warn font-mono text-[11px]">⚠ unscored</span>
        )}
      </div>

      <p className="m-0 mt-3.5 text-[40px] font-semibold leading-none tracking-[-0.03em]">
        {head.band ? (
          <>
            ₹{rupeesToCrore(head.band.low).toFixed(0)}–{rupeesToCrore(head.band.high).toFixed(0)}
            <span className="text-muted-foreground text-xl font-medium">cr</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </p>

      <p className="text-ink2 m-0 mt-2 text-[13px]">
        {head.lastPrinted ? (
          <>
            Last printed {formatCrore(head.lastPrinted.valueInr)}
            {head.yoy != null ? (
              <>
                {' · '}
                <span className={head.yoy >= 0 ? 'text-good' : 'text-bad'}>
                  {head.yoy >= 0 ? '▲' : '▼'} {head.yoy >= 0 ? '+' : ''}
                  {(head.yoy * 100).toFixed(1)}% YoY
                </span>
              </>
            ) : null}
          </>
        ) : (
          'No confirmed print on record yet.'
        )}
      </p>

      <div className="mt-4.5">
        <div className="text-muted-foreground mb-1.5 flex justify-between font-mono text-[11px]">
          <span>quarter {pct}% elapsed</span>
          <span>{daysLeft}d left</span>
        </div>
        <div className="bg-gridline h-[5px] overflow-hidden rounded-[3px]">
          <div className="bg-accent h-[5px]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {!head.band ? (
        <p className="border-warn/40 bg-warn/5 text-ink2 mt-4 rounded-md border p-3 text-xs leading-relaxed">
          No estimate has been stored for this quarter yet. The nowcast cron writes one daily; until
          it runs, this is genuinely unknown rather than zero.
        </p>
      ) : null}

      <Disclose
        summary={
          head.company === 'SAREGAMA'
            ? 'Why the two bands are not comparable'
            : 'What this band is'
        }
        className="border-border mt-4 border-t pt-3.5"
      >
        {head.company === 'SAREGAMA'
          ? 'Tips reports a single segment, so its revenue line is the music line. Saregama’s group revenue also carries artist management, video and events — this band covers the music segment only, and the two headline figures are not like for like.'
          : 'Measured quarter-to-date catalogue reach, extrapolated to the full quarter on elapsed days, converted at a rupee-per-thousand-views band and uplifted for revenue that never appears on YouTube. The band width is the honest spread on that rate, not a confidence interval.'}
      </Disclose>
    </Card>
  );
}

async function FiledActuals() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast);

  const rows = await getReportedFinancials();
  const quarters = rows
    .filter((r) => / Q[1-4]$/.test(r.fiscal_label))
    .sort((a, b) => (a.fiscal_label < b.fiscal_label ? 1 : -1));

  // Year-on-year needs the same quarter a year earlier, keyed off the label.
  const byKey = new Map(rows.map((r) => [`${r.company}|${r.fiscal_label}`, r.value_inr]));
  const yoyFor = (company: string, label: string): number | null => {
    const m = /^FY(\d{2}) Q([1-4])$/.exec(label);
    if (!m) return null;
    const prior = byKey.get(`${company}|FY${String(Number(m[1]) - 1).padStart(2, '0')} Q${m[2]}`);
    if (prior === undefined || prior <= 0) return null;
    const cur = byKey.get(`${company}|${label}`);
    return cur === undefined ? null : (cur - prior) / prior;
  };

  return (
    <Card className="overflow-hidden">
      <CardHead title="Filed actuals">
        <span className="text-muted-foreground font-mono text-[11px]">
          only confirmed rows are scored
        </span>
      </CardHead>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-left font-mono text-[10px] uppercase tracking-eyebrow">
              <th className="px-pad py-2.5 font-medium">Company</th>
              <th className="px-3.5 py-2.5 font-medium">Period</th>
              <th className="px-3.5 py-2.5 text-right font-medium">Revenue</th>
              <th className="px-3.5 py-2.5 text-right font-medium">YoY</th>
              <th className="px-3.5 py-2.5 font-medium">Status</th>
              <th className="px-pad py-2.5 text-right font-medium">Line</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((r, i) => {
              const yoy = yoyFor(r.company, r.fiscal_label);
              return (
                <tr
                  key={`${r.company}-${r.fiscal_label}`}
                  className={i < quarters.length - 1 ? 'border-border border-b' : ''}
                >
                  <td className="px-pad py-row font-medium">{r.company}</td>
                  <td className="px-3.5 py-row font-mono text-xs">{r.fiscal_label}</td>
                  <td className="px-3.5 py-row text-right font-mono text-xs">
                    {formatCrore(r.value_inr)}
                  </td>
                  <td
                    className={`px-3.5 py-row text-right font-mono text-xs ${
                      yoy == null ? 'text-muted-foreground' : yoy >= 0 ? 'text-good' : 'text-bad'
                    }`}
                  >
                    {yoy == null ? '—' : `${yoy >= 0 ? '▲ +' : '▼ '}${(yoy * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-3.5 py-row text-xs">
                    {r.confirmed ? (
                      <span className="text-good">✓ confirmed</span>
                    ) : (
                      <span className="text-warn">⚠ unconfirmed</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-pad py-row text-right font-mono text-[11px]">
                    {r.line_item.replace(/_/g, ' ')}
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

async function TrackRecord() {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.nowcast);

  const asof = new Date().toISOString().slice(0, 10);
  const [tips, sare] = await Promise.all([
    getNowcastHeadline('TIPSMUSIC', asof),
    getNowcastHeadline('SAREGAMA', asof),
  ]);
  const records = [tips, sare];
  const anyScored = records.some((r) => r.trackRecord.n > 0);

  return (
    <Card>
      <CardHead title="Track record" note="the only reason to believe the bands above" />
      {!anyScored ? (
        <div className="p-pad">
          <div className="border-warn/50 bg-warn/5 rounded-md border p-4">
            <p className="text-ink m-0 text-[15px] font-semibold">
              No estimate has been scored yet.
            </p>
            <p className="text-ink2 m-0 mt-2 max-w-[88ch] text-xs leading-relaxed">
              The nowcast has never been checked against a printed result, so it carries no accuracy
              record and should not be relied on. From the first scored quarter this panel shows
              every past estimate, its error, and whether the actual landed inside the band. An
              empty table would read as &ldquo;no misses&rdquo;; the truth is &ldquo;never
              checked&rdquo;.
            </p>
          </div>
          <div className="text-muted-foreground mt-4 grid grid-cols-2 gap-6 font-mono text-[11px] sm:grid-cols-4">
            {['Quarters scored', 'Hit rate', 'Median abs error', 'Worst miss'].map((l) => (
              <div key={l}>
                <div className="uppercase tracking-eyebrow">{l}</div>
                <div className="text-muted-foreground mt-1 text-lg">—</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left font-mono text-[10px] uppercase tracking-eyebrow">
                <th className="px-pad py-2.5 font-medium">Company</th>
                <th className="px-3.5 py-2.5 text-right font-medium">Scored</th>
                <th className="px-3.5 py-2.5 text-right font-medium">Inside band</th>
                <th className="px-3.5 py-2.5 text-right font-medium">Median abs err</th>
                <th className="px-pad py-2.5 font-medium">Worst miss</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.company} className={i === 0 ? 'border-border border-b' : ''}>
                  <td className="px-pad py-row font-medium">{LABEL[r.company] ?? r.company}</td>
                  <td className="px-3.5 py-row text-right font-mono text-xs">{r.trackRecord.n}</td>
                  <td className="px-3.5 py-row text-right font-mono text-xs">
                    {r.trackRecord.hitRate == null
                      ? '—'
                      : `${(r.trackRecord.hitRate * 100).toFixed(0)}%`}
                  </td>
                  <td className="px-3.5 py-row text-right font-mono text-xs">
                    {r.trackRecord.medianAbsPctError == null
                      ? '—'
                      : `${r.trackRecord.medianAbsPctError.toFixed(1)}%`}
                  </td>
                  <td className="text-ink2 px-pad py-row text-xs">
                    {r.trackRecord.worst
                      ? `${r.trackRecord.worst.fiscalLabel} — estimated ${formatCrore(r.trackRecord.worst.estimate.mid)}, printed ${formatCrore(r.trackRecord.worst.actual)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Block({ h }: { h: number }) {
  return (
    <div
      className="border-border bg-surface2/50 rounded-card animate-pulse border"
      style={{ height: h }}
    />
  );
}
