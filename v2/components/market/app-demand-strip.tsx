import type { AppProxyRow, DemandLayerSnapshot } from '@/lib/queries';
import { Panel, EmptyNote, fmtCount, fmtSigned } from './panel';

/**
 * Public app-store demand proxies per DSP, with weekly-increment momentum.
 *
 * ⚠️ The caveat is the point of this panel, not a footnote: rating counts and
 * install buckets are CUMULATIVE and never decrement for churn, so they are
 * gross funnel-top demand — never paid subscribers, never a share figure. They
 * are graded LOW and are deliberately NOT bias-weighted into the per-company
 * IR READ (mirroring the additive peerRankMomentum precedent).
 *
 * Momentum is SECTOR-level by construction: an app's rating velocity says
 * something about the DSP, nothing about which label's catalog is being played.
 */

const ARROW = { up: '▲', down: '▼', flat: '◆' } as const;
const ARROW_COLOR = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  flat: 'text-muted-foreground',
} as const;

const STORE_LABEL: Record<string, string> = {
  app_store: 'iOS',
  play_store: 'Android',
};

export function AppDemandStrip({ snapshot }: { snapshot: DemandLayerSnapshot }) {
  const { apps } = snapshot;
  if (apps.length === 0) {
    return (
      <Panel
        title="App demand proxies (India)"
        subtitle="gross funnel-top signals — never paid subscribers"
      >
        <EmptyNote>
          No rows in <code className="font-mono">fct_app_proxy_daily</code> yet. Populated
          daily by the <code className="font-mono">/api/cron/app-ratings</code> and{' '}
          <code className="font-mono">/api/cron/appstore-charts</code> jobs (02:00 / 02:30
          UTC) once migration <code className="font-mono">0024_app_proxy.sql</code> is
          pushed. Momentum needs ~30 days of history before it reports a direction.
        </EmptyNote>
      </Panel>
    );
  }

  const warming = apps.filter((a) => a.momentum.warming).length;

  return (
    <Panel
      title="App demand proxies (India)"
      subtitle="cumulative ratings / installs — GROSS demand, never paid subscribers, never bias-weighted into the READ"
      right={
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {apps.length} listings{warming > 0 ? ` · ${warming} warming` : ''}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground border-border/60 border-b">
            <tr>
              <th className="py-1.5 pr-3 font-medium">App</th>
              <th className="py-1.5 pr-3 font-medium">Store</th>
              <th className="py-1.5 pr-3 text-right font-medium">Ratings</th>
              <th className="py-1.5 pr-3 text-right font-medium">Avg</th>
              <th className="py-1.5 pr-3 text-right font-medium">Velocity</th>
              <th className="py-1.5 pr-3 text-right font-medium">Momentum</th>
              <th className="py-1.5 font-medium">Installs</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <Row key={`${a.dsp}|${a.store}|${a.source}`} app={a} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground/70 mt-3 text-[11px]">
        ⚠️ Cumulative metrics never decrement for churn, and off-store billing (Jio / UPI /
        web) is invisible to the stores — so these under-count India paid conversion and
        over-state retention. Directional velocity only.
      </p>
    </Panel>
  );
}

function Row({ app }: { app: AppProxyRow }) {
  const m = app.momentum;
  const velocityLabel =
    app.rating_count_30d_delta == null
      ? '—'
      : fmtSigned(app.rating_count_30d_delta);
  // Label the REAL span: a missed cron day pushes the anchor past 30 days, and
  // silently calling that "30d" would overstate the daily rate.
  const spanNote =
    app.delta_span_days != null && app.delta_span_days !== 30
      ? `${app.delta_span_days}d`
      : '30d';

  return (
    <tr className="border-border/30 border-b last:border-0">
      <td className="text-foreground py-1.5 pr-3 font-medium capitalize">
        {app.dsp.replace(/_/g, ' ')}
      </td>
      <td className="text-muted-foreground py-1.5 pr-3">
        {STORE_LABEL[app.store] ?? app.store}
        <span className="text-muted-foreground/50 ml-1 text-[10px]">{app.source}</span>
      </td>
      <td className="text-foreground py-1.5 pr-3 text-right tabular-nums">
        {fmtCount(app.rating_count)}
      </td>
      <td className="text-muted-foreground py-1.5 pr-3 text-right tabular-nums">
        {app.rating_avg != null ? Number(app.rating_avg).toFixed(2) : '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        <span className="text-foreground">{velocityLabel}</span>
        <span className="text-muted-foreground/50 ml-1 text-[10px]">
          {app.rating_count_30d_delta == null ? `${app.days_observed}d obs` : spanNote}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {m.warming ? (
          <span className="text-muted-foreground/60 text-[11px]" title={m.caveat}>
            warming
          </span>
        ) : (
          <span title={m.caveat}>
            <span className="text-foreground">
              {m.sigma != null ? `${m.sigma >= 0 ? '+' : ''}${m.sigma.toFixed(1)}σ` : '—'}
            </span>
            <span className={`${ARROW_COLOR[m.direction]} ml-1 text-[10px]`}>
              {ARROW[m.direction]}
            </span>
            {m.significant ? (
              <span className="text-emerald-400 ml-0.5 text-[10px]" title="significant">
                ✓
              </span>
            ) : null}
          </span>
        )}
      </td>
      <td className="text-muted-foreground/70 py-1.5 text-[11px] tabular-nums">
        {app.install_bucket ?? '—'}
      </td>
    </tr>
  );
}
