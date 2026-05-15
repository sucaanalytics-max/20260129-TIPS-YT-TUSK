import type { CompanySnapshot, PeriodLabel } from '@/lib/queries';
import { formatNumber } from '@/lib/queries';

const PERIODS: { label: PeriodLabel; title: string; hint: string }[] = [
  { label: '1d',   title: '1d',   hint: 'last 24h vs prior 24h' },
  { label: '7d',   title: 'WoW',  hint: 'last 7d avg vs prior 7d avg' },
  { label: '30d',  title: 'MoM',  hint: 'last 30d avg vs prior 30d avg' },
  { label: '90d',  title: 'QoQ',  hint: 'last 90d avg vs prior 90d avg' },
  { label: 'QTD',  title: 'QTD',  hint: 'quarter to date vs same span last quarter' },
  { label: 'YTD',  title: 'YTD',  hint: 'year to date vs same span last year' },
  { label: '365d', title: 'YoY',  hint: 'last 365d avg vs prior 365d avg' },
];

export function CompanyGrowth({ snapshots }: { snapshots: CompanySnapshot[] }) {
  if (!snapshots.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no growth data yet
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {snapshots.map((s) => (
        <div key={s.company} className="border-border bg-card rounded-lg border">
          <header className="border-border flex items-baseline justify-between border-b px-5 py-4">
            <div>
              <h3 className="text-foreground text-base font-semibold">{s.company}</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {s.channels_active} channels reporting · as of {s.latest_date ?? '—'}
              </p>
            </div>
            <div className="flex items-baseline gap-6 text-right">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Cumulative views</p>
                <p className="text-foreground mt-0.5 text-sm font-medium tabular-nums">{formatNumber(s.cumulative_views)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Subs (YoY Δ)</p>
                <p className="text-foreground mt-0.5 text-sm font-medium tabular-nums">
                  {formatNumber(s.cumulative_subscribers)}{' '}
                  {s.subscribers_yoy_delta != null ? (
                    <span className={s.subscribers_yoy_delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {s.subscribers_yoy_delta >= 0 ? '+' : ''}
                      {formatNumber(s.subscribers_yoy_delta)}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3 text-right">Current avg daily views</th>
                  <th className="px-5 py-3 text-right">Prior period avg</th>
                  <th className="px-5 py-3 text-right">Growth</th>
                  <th className="px-5 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((p) => {
                  const row = s.rows.find((r) => r.period === p.label);
                  const curAvg =
                    row?.current_sum != null && row.current_n > 0
                      ? Math.round(row.current_sum / row.current_n)
                      : null;
                  const priAvg =
                    row?.prior_sum != null && row.prior_n > 0
                      ? Math.round(row.prior_sum / row.prior_n)
                      : null;
                  const positive = (row?.growth_pct ?? 0) >= 0;
                  return (
                    <tr key={p.label} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
                      <td className="px-5 py-3 font-medium">{p.title}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatNumber(curAvg)}</td>
                      <td className="text-muted-foreground px-5 py-3 text-right tabular-nums">{formatNumber(priAvg)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {row?.growth_pct != null ? (
                          <span className={positive ? 'text-emerald-400' : 'text-red-400'}>
                            {positive ? '+' : ''}
                            {row.growth_pct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-5 py-3 text-xs">{p.hint}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
