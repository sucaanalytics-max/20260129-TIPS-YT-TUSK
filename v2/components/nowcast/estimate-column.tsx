import { formatCrore, rupeesToCrore } from '@/lib/financials';
import type { NowcastHeadline } from '@/lib/queries';
import { Eyebrow, Figure, ProgressRule, Stat } from '@/components/broadsheet';

const COMPANY_NAME: Record<string, string> = {
  TIPSMUSIC: 'TIPS MUSIC',
  SAREGAMA: 'SAREGAMA · MUSIC SEGMENT',
};

/**
 * What each company's line is measured on. Stated on the page rather than in a
 * footnote because the two are NOT the same thing: Tips reports a single
 * segment, so its revenue line is the music line, while Saregama's group
 * revenue also carries artist management, video and events. Comparing the two
 * headline numbers without this caption compares different businesses.
 */
const BASIS: Record<string, string> = {
  TIPSMUSIC: 'total revenue from operations · single segment',
  SAREGAMA: 'music only — excludes artist mgmt, video, events',
};

/** A band renders as a range, not a point. The width IS the claim. */
function bandLabel(band: { low: number; high: number }): string {
  const lo = rupeesToCrore(band.low);
  const hi = rupeesToCrore(band.high);
  const dp = hi - lo < 10 ? 1 : 0;
  return `₹${lo.toFixed(dp)}–${hi.toFixed(dp)}`;
}

export function EstimateColumn({ head }: { head: NowcastHeadline }) {
  const pct = head.quarterProgress * 100;

  return (
    <div>
      <div className="font-serif text-[15px] font-semibold tracking-[0.02em]">
        {COMPANY_NAME[head.company] ?? head.company}
      </div>
      <div className="text-muted-foreground mt-0.5 text-[11.5px]">{BASIS[head.company]}</div>

      <div className="mt-4">
        {head.band ? (
          <Figure value={bandLabel(head.band)} unit="cr" size="lg" />
        ) : (
          <Figure value="—" size="lg" tone="muted" />
        )}
      </div>

      {/*
        The badge is the most important element in this column. An unscored model
        with a number beside it invites exactly the reading it has not earned, so
        the caveat sits at the figure rather than in a footnote.
      */}
      <div className="border-accent text-accent mt-2.5 inline-block border px-[7px] py-[3px] text-[10.5px] uppercase tracking-[0.06em]">
        {head.band
          ? head.trackRecord.n === 0
            ? 'Unscored — no quarter has been checked yet'
            : `Scored over ${head.trackRecord.n} quarter${head.trackRecord.n === 1 ? '' : 's'}`
          : 'No estimate stored yet'}
      </div>

      <ProgressRule pct={pct} />

      <div className="border-border mt-5 flex flex-wrap gap-x-[34px] gap-y-4 border-t pt-4">
        <Stat
          label={head.lastPrinted ? `Last printed · ${head.lastPrinted.fiscalLabel}` : 'Last printed'}
          value={head.lastPrinted ? formatCrore(head.lastPrinted.valueInr) : '—'}
        />
        <Stat
          label="Year on year"
          value={head.yoy === null ? '—' : `${head.yoy >= 0 ? '+' : ''}${(head.yoy * 100).toFixed(1)}%`}
          tone={head.yoy === null ? 'muted' : head.yoy >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label={head.fullYear ? `${head.fullYear.fiscalLabel} full year` : 'Full year'}
          value={head.fullYear ? formatCrore(head.fullYear.valueInr) : '—'}
        />
      </div>

      {head.band ? (
        <div className="text-muted-foreground mt-3 text-[11px]">
          <Eyebrow>Estimated {head.band.asof} · midpoint {formatCrore(head.band.mid)}</Eyebrow>
        </div>
      ) : null}
    </div>
  );
}
