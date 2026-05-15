import { LeadLagBars } from '@/components/charts/lead-lag-bars';
import type { LeadLagRow } from '@/lib/queries';

/**
 * Wraps the existing LeadLagBars chart with a company label and a "warming
 * up" placeholder. fct_correlation_window is currently TIPSMUSIC-only, so
 * SAREGAMA always shows the placeholder until the Python stats service is
 * extended to compute per-company correlation grids.
 */
export function LeadLagPanorama({
  company,
  data,
  windowDays,
}: {
  company: string;
  data: LeadLagRow[];
  windowDays: number;
}) {
  if (data.length === 0) {
    return (
      <div className="border-border bg-card flex h-72 flex-col rounded-lg border p-4">
        <h3 className="text-foreground text-sm font-medium">
          Lead-lag · {company}
        </h3>
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          warming up — per-company correlation grid not yet computed
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {company}
      </p>
      <LeadLagBars data={data} windowDays={windowDays} />
    </div>
  );
}
