import type { DemandLayerSnapshot } from '@/lib/queries';
import { Panel, EmptyNote, fmtCount } from './panel';

/**
 * Spotify's regional disclosure — the ONLY public source that measures actual
 * PAID subscribers touching India.
 *
 * The catch, stated on the panel because it governs how the number may be
 * used: Spotify reports four regions only, and India sits inside "Rest of
 * World". RoW is Spotify's largest USER region but its smallest PAYING region,
 * so this is a noisy India proxy — valuable as backtest ground truth for the
 * demand layer, never as an India subscriber count.
 */
export function SpotifyRowStrip({ snapshot }: { snapshot: DemandLayerSnapshot }) {
  const s = snapshot.spotify_regional;
  if (!s) {
    return (
      <Panel title="Spotify — Rest of World (the only true paid signal)">
        <EmptyNote>
          No rows in <code className="font-mono">fct_spotify_regional</code> — seeded by
          migration <code className="font-mono">0023_spotify_regional.sql</code> and
          updated manually each quarter from the shareholder letter / 6-K.
        </EmptyNote>
      </Panel>
    );
  }

  const rowPremium =
    s.premium_total != null && s.premium_row_pct != null
      ? s.premium_total * (Number(s.premium_row_pct) / 100)
      : null;

  return (
    <Panel
      title="Spotify — Rest of World (the only true paid signal)"
      subtitle="India sits inside RoW · largest user region, smallest paying region — a noisy proxy, used as backtest ground truth"
      right={
        <span className="text-muted-foreground text-[11px] tabular-nums">Q/E {s.asof}</span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Global MAU" value={fmtCount(s.mau_total)} />
        <Tile label="Global Premium subs" value={fmtCount(s.premium_total)} />
        <Tile
          label="RoW Premium (implied)"
          value={rowPremium != null ? fmtCount(rowPremium) : '—'}
          sub={
            s.premium_row_pct != null
              ? `${Number(s.premium_row_pct).toFixed(0)}% of Premium — India is the bulk of RoW`
              : undefined
          }
        />
      </div>
      <p className="text-muted-foreground/70 mt-3 text-[11px]">
        ⚠️ RoW is not India. Treat the implied figure as an upper bound on the region, never
        as an India subscriber count — Spotify has never disclosed an India split.
      </p>
    </Panel>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-border/40 rounded-md border p-3">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-muted-foreground/70 text-[10px]">{sub}</div> : null}
    </div>
  );
}
