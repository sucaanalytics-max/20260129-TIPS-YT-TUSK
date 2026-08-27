import type { DemandLayerSnapshot } from '@/lib/queries';
import { Panel, EmptyNote } from './panel';

/**
 * Apple "most-played" India songs chart, flagged where the credited artist
 * matches the labels' catalog.
 *
 * This is the LEGAL substitute for DSP playlist-placement tracking: Spotify's
 * editorial-playlist API is closed to new apps, and JioSaavn/Gaana scraping is
 * ToS-risky. Apple's public RSS chart is the one catalog-demand signal we can
 * take cleanly. Presence ≠ streams ≠ revenue — it is a directional read on
 * whether the catalog is in the current conversation.
 */
export function CatalogChartStrip({ snapshot }: { snapshot: DemandLayerSnapshot }) {
  const c = snapshot.catalog_chart;
  if (!c.date || c.total === 0) {
    return (
      <Panel title="Catalog chart presence — Apple most-played (India)">
        <EmptyNote>
          No rows in <code className="font-mono">fct_catalog_chart_presence</code> yet.
          Populated daily by <code className="font-mono">/api/cron/appstore-charts</code>{' '}
          once migration <code className="font-mono">0024_app_proxy.sql</code> is pushed.
        </EmptyNote>
      </Panel>
    );
  }

  const pct = c.total > 0 ? (c.matches / c.total) * 100 : 0;

  return (
    <Panel
      title="Catalog chart presence — Apple most-played (India)"
      subtitle="the legal stand-in for DSP playlist placement · presence ≠ streams ≠ revenue"
      right={
        <span className="text-muted-foreground text-[11px] tabular-nums">{c.date}</span>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="text-foreground text-lg font-semibold tabular-nums">
          {c.matches}/{c.total}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {pct.toFixed(0)}% of the chart is catalog-matched
        </span>
      </div>

      {c.matches === 0 ? (
        <p className="text-muted-foreground/70 mt-2 text-[11px]">
          No catalog artist in today&apos;s chart. Matching is a substring test on credited
          artist names, so a compilation or a mis-credited feature can read as a miss.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {c.matched.map((m) => (
            <li key={`${m.rank}-${m.track_title}`} className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground w-8 shrink-0 tabular-nums">#{m.rank}</span>
              <span className="text-foreground truncate">{m.track_title ?? '—'}</span>
              <span className="text-muted-foreground/70 truncate text-[11px]">
                {m.artist ?? ''}
              </span>
              {m.matched_company ? (
                <span className="ml-auto shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                  {m.matched_company}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
