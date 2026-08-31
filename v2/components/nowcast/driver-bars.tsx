import { formatCrore } from '@/lib/financials';
import type { DriverContribution, NowcastDrivers } from '@/lib/nowcast';
import { seriesColor, NEUTRAL } from '@/lib/chart-palette';
import { Eyebrow } from '@/components/broadsheet';

const LABEL: Record<DriverContribution['driver'], string> = {
  owned: 'Owned channels',
  topic: 'Topic / OAC attributed',
  ugc: 'UGC',
};

const VIEWS: Record<DriverContribution['driver'], 'ownedViews' | 'topicViews' | 'ugcViews'> = {
  owned: 'ownedViews',
  topic: 'topicViews',
  ugc: 'ugcViews',
};

/**
 * Where the midpoint comes from, as a share of itself.
 *
 * A stacked bar would imply the drivers are parts of one flow; they are
 * separately attributed and separately uncertain, so each gets its own rule.
 * Every bar is directly labelled — identity never rests on colour alone.
 */
export function DriverBars({
  contributions,
  drivers,
  mid,
}: {
  contributions: DriverContribution[];
  drivers: NowcastDrivers;
  mid: number;
}) {
  // Excluded drivers contribute nothing and would otherwise render as an
  // unexplained empty row; they are shown, but greyed and named as excluded.
  const shown = contributions.filter((c) => c.driver !== 'ugc' || drivers.ugcViews > 0);
  // pctOfMid arrives from computeNowcast ALREADY on a 0-100 scale (it is
  // (mid / band.mid) * 100). Never multiply it by 100 again on the way out.
  const max = Math.max(...shown.map((c) => c.pctOfMid), 1);

  return (
    <div className="mt-5">
      <div className="border-border flex items-baseline justify-between border-b pb-2">
        <Eyebrow>Contribution to the midpoint</Eyebrow>
        <span className="tnum font-serif text-lg font-semibold">{formatCrore(mid)}</span>
      </div>

      <ul className="mt-4 space-y-3.5">
        {shown.map((c, i) => (
          <li key={c.driver}>
            <div className="flex items-baseline justify-between gap-4 text-[12.5px]">
              <span>{LABEL[c.driver]}</span>
              <span className="tnum text-muted-foreground">
                {Math.round(drivers[VIEWS[c.driver]]).toLocaleString('en-IN')} views ·{' '}
                <span className="text-foreground font-medium">{formatCrore(c.mid)}</span> ·{' '}
                {c.pctOfMid.toFixed(0)}%
              </span>
            </div>
            <div className="bg-muted mt-1.5 h-[7px]">
              <div
                className="h-[7px]"
                style={{
                  width: `${(c.pctOfMid / max) * 100}%`,
                  background: i < 3 ? seriesColor(i) : NEUTRAL,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {drivers.ugcViews === 0 ? (
        <p className="text-muted-foreground mt-3 text-[11px] italic">
          UGC is measured but excluded from the estimate — see Assumptions below.
        </p>
      ) : null}
    </div>
  );
}
