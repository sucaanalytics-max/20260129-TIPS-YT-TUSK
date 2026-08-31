import { rupeesToCrore } from '@/lib/financials';
import type { NowcastHeadline } from '@/lib/queries';

const COMPANY_NAME: Record<string, string> = {
  TIPSMUSIC: 'Tips Music',
  SAREGAMA: 'Saregama · music segment',
};

/**
 * What each company's line is measured on. Stated beside the name rather than
 * in a footnote because the two are NOT the same thing: Tips reports a single
 * segment, so its revenue line is the music line, while Saregama's group
 * revenue also carries artist management, video and events. Comparing the two
 * headline numbers without this caption compares different businesses.
 */
const BASIS: Record<string, string> = {
  TIPSMUSIC: 'total revenue from operations · single segment',
  SAREGAMA: 'music only — excludes artist mgmt, video, events',
};

const DAY = 86_400_000;

function crore(n: number, dp = 2): string {
  return `₹${rupeesToCrore(n).toFixed(dp)}cr`;
}

/** A band renders as a range, not a point. The width IS the claim. */
function bandLabel(band: { low: number; high: number }): string {
  const lo = rupeesToCrore(band.low);
  const hi = rupeesToCrore(band.high);
  const dp = hi - lo < 10 ? 1 : 0;
  return `₹${lo.toFixed(dp)}–${hi.toFixed(dp)}cr`;
}

function daysToEnd(asof: string, end: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${asof}T00:00:00Z`)) / DAY),
  );
}

/**
 * Direction is carried by the ▲/▼ glyph and the sign as well as the colour, so
 * the up/down reading survives a red-green colour deficiency.
 */
function deltaClass(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  return n >= 0 ? 'text-good' : 'text-critical';
}

function deltaArrow(n: number | null): string {
  if (n == null) return '';
  return n >= 0 ? '▲ ' : '▼ ';
}

function Kpi({
  label,
  value,
  muted,
  children,
}: {
  label: string;
  value: string;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      {children}
    </div>
  );
}

function CompanyBlock({ head, asof }: { head: NowcastHeadline; asof: string }) {
  const pct = Math.min(100, Math.max(0, head.quarterProgress * 100));
  const left = daysToEnd(asof, head.fiscal.end);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-foreground text-sm font-medium uppercase tracking-wider">
          {COMPANY_NAME[head.company] ?? head.company}
        </h3>
        <span className="text-muted-foreground text-xs">{BASIS[head.company]}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label={`Nowcast · ${head.fiscal.label}`}
          value={head.band ? bandLabel(head.band) : '—'}
          muted={!head.band}
        >
          {head.band ? (
            head.trackRecord.n === 0 ? (
              <p className="text-warning mt-1 text-xs">
                ⚠ unscored — no quarter checked yet
              </p>
            ) : (
              <p className="text-good mt-1 text-xs">
                ✓ scored over {head.trackRecord.n} quarter{head.trackRecord.n === 1 ? '' : 's'}
              </p>
            )
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">
              no estimate stored yet — cron has not run
            </p>
          )}
        </Kpi>

        <Kpi
          label="Last printed"
          value={head.lastPrinted ? crore(head.lastPrinted.valueInr) : '—'}
          muted={!head.lastPrinted}
        >
          <p className="text-muted-foreground mt-1 text-xs">
            {head.lastPrinted ? `${head.lastPrinted.fiscalLabel} · confirmed filing` : 'no confirmed quarter'}
          </p>
        </Kpi>

        <Kpi
          label="Year on year"
          value={
            head.yoy === null
              ? '—'
              : `${deltaArrow(head.yoy)}${head.yoy >= 0 ? '+' : ''}${(head.yoy * 100).toFixed(1)}%`
          }
          muted={head.yoy === null}
        >
          <p className={`mt-1 text-xs ${deltaClass(head.yoy)}`}>
            {head.yoy === null
              ? 'year-ago quarter not stored'
              : `${head.yoy >= 0 ? 'up on' : 'down on'} the same quarter last year`}
          </p>
        </Kpi>

        <Kpi
          label={head.fullYear ? `${head.fullYear.fiscalLabel} full year` : 'Full year'}
          value={head.fullYear ? crore(head.fullYear.valueInr) : '—'}
          muted={!head.fullYear}
        >
          <p className="text-muted-foreground mt-1 text-xs">
            {head.fullYear ? 'reported, confirmed' : 'no full year stored'}
          </p>
        </Kpi>

        <Kpi label="Quarter progress" value={`${pct.toFixed(0)}%`}>
          <div className="bg-muted mt-2 h-1 w-full overflow-hidden rounded">
            <div className="bg-info h-full" style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {left} day{left === 1 ? '' : 's'} to quarter end
          </p>
        </Kpi>
      </div>
    </div>
  );
}

/**
 * The answer, per company, as five measured cells rather than one large number.
 * A null band renders as an em dash with the reason attached — never as a zero,
 * because a zero here reads as a forecast of no revenue.
 */
export function NowcastKpiStrip({
  heads,
  asof,
}: {
  heads: NowcastHeadline[];
  asof: string;
}) {
  if (!heads.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no nowcast rows — waiting on the first /api/cron/nowcast run
      </div>
    );
  }
  return (
    <section className="space-y-6">
      {heads.map((head) => (
        <CompanyBlock key={head.company} head={head} asof={asof} />
      ))}
    </section>
  );
}
