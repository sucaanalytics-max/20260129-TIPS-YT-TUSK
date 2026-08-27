import type { DemandLayerSnapshot } from '@/lib/queries';
import { Panel, EmptyNote } from './panel';

/**
 * The India DSP registry and its consolidation story: three major DSPs folded
 * in ~18 months (Resso, Wynk, Hungama) and Gaana went paid-only. That
 * shake-out is the supply-side half of the paid-migration thesis — fewer free
 * tiers competing away willingness to pay.
 */

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-emerald-500/15 text-emerald-300', label: 'active' },
  paywall: { cls: 'bg-sky-500/15 text-sky-300', label: 'paid-only' },
  restructuring: { cls: 'bg-amber-500/15 text-amber-300', label: 'restructuring' },
  shutdown: { cls: 'bg-muted/30 text-muted-foreground', label: 'shut down' },
};

export function DspStatusTable({ snapshot }: { snapshot: DemandLayerSnapshot }) {
  const { dsps } = snapshot;
  if (dsps.length === 0) {
    return (
      <Panel title="India DSP landscape" subtitle="who is still standing, and on what model">
        <EmptyNote>
          No rows in <code className="font-mono">dim_dsp</code> — seeded by migration{' '}
          <code className="font-mono">0022_dsp_market.sql</code>.
        </EmptyNote>
      </Panel>
    );
  }

  const live = dsps.filter((d) => d.status !== 'shutdown').length;
  const gone = dsps.length - live;

  return (
    <Panel
      title="India DSP landscape"
      subtitle="who is still standing, and on what model — free-tier consolidation is the supply-side half of the paid-migration thesis"
      right={
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {live} operating · {gone} shut down
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground border-border/60 border-b">
            <tr>
              <th className="py-1.5 pr-3 font-medium">DSP</th>
              <th className="py-1.5 pr-3 font-medium">Owner</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">As of</th>
              <th className="py-1.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {dsps.map((d) => {
              const st = STATUS_STYLE[d.status] ?? {
                cls: 'bg-muted/30 text-muted-foreground',
                label: d.status,
              };
              const dim = d.status === 'shutdown';
              return (
                <tr key={d.dsp} className="border-border/30 border-b last:border-0">
                  <td className={`py-1.5 pr-3 font-medium ${dim ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {d.display_name}
                  </td>
                  <td className="text-muted-foreground py-1.5 pr-3">{d.owner ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="text-muted-foreground/70 py-1.5 pr-3 tabular-nums">
                    {d.status_asof ?? '—'}
                  </td>
                  <td className="text-muted-foreground/70 py-1.5 text-[11px]">{d.notes ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
