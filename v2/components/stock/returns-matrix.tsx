import type { ReturnsMatrixRow } from '@/lib/queries';

const PERIODS: Array<{ key: keyof ReturnsMatrixRow; label: string }> = [
  { key: 'ret_1d', label: '1d' },
  { key: 'ret_5d', label: '5d' },
  { key: 'ret_1m', label: '1m' },
  { key: 'ret_3m', label: '3m' },
  { key: 'ret_6m', label: '6m' },
  { key: 'ret_ytd', label: 'YTD' },
  { key: 'ret_1y', label: '1y' },
  { key: 'ret_3y', label: '3y' },
  { key: 'ret_inception', label: 'Inception' },
];

function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function color(n: number | null): string {
  if (n == null) return 'text-muted-foreground';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

export function ReturnsMatrix({ rows }: { rows: ReturnsMatrixRow[] }) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <h3 className="text-foreground text-sm font-medium">Returns (log)</h3>
      <p className="text-muted-foreground mt-0.5 text-xs">computed on adjusted close</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-3">Period</th>
              {rows.map((r) => (
                <th key={r.symbol} className="py-2 pr-3 text-right">
                  {r.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p.label} className="border-border/40 border-b last:border-0">
                <td className="text-foreground py-2 pr-3 font-medium">{p.label}</td>
                {rows.map((r) => {
                  const v = r[p.key] as number | null;
                  return (
                    <td
                      key={r.symbol}
                      className={`py-2 pr-3 text-right tabular-nums ${color(v)}`}
                    >
                      {fmtPct(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
