import type { StockDeepDive } from '@/lib/queries';

const TYPE_COLOR: Record<string, string> = {
  split: 'text-red-300',
  bonus: 'text-amber-300',
  dividend: 'text-emerald-300',
  rights: 'text-violet-300',
  merger: 'text-pink-300',
};

export function CorporateActionsTable({ deepDives }: { deepDives: StockDeepDive[] }) {
  const rows = deepDives.flatMap((d) =>
    d.corp_actions.map((a) => ({ symbol: d.symbol, ...a })),
  );
  if (!rows.length) {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">Corporate actions</h3>
        <p className="text-muted-foreground mt-2 text-xs">no corporate actions in range</p>
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Corporate actions</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">splits · bonuses · dividends</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-3">Ex-date</th>
              {deepDives.length > 1 ? <th className="py-2 pr-3">Symbol</th> : null}
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .sort((a, b) => b.ex_date.localeCompare(a.ex_date))
              .map((r, i) => (
                <tr
                  key={`${r.symbol}-${r.ex_date}-${i}`}
                  className="border-border/40 border-b last:border-0"
                >
                  <td className="text-foreground tabular-nums py-2 pr-3">{r.ex_date}</td>
                  {deepDives.length > 1 ? (
                    <td className="text-muted-foreground py-2 pr-3">{r.symbol}</td>
                  ) : null}
                  <td className={`py-2 pr-3 ${TYPE_COLOR[r.action_type] ?? 'text-foreground'}`}>
                    {r.action_type}
                  </td>
                  <td className="text-foreground py-2 pr-3">{r.label}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
