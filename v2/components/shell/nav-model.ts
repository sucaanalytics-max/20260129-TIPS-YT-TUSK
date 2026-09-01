/**
 * The four-tab information architecture, lifted from the handoff design.
 *
 * Fourteen flat routes collapse into these. `absorbs` is the redirect map: it
 * is the single record of where each retired page went, and both the redirects
 * in next.config and the deep-link anchors below are derived from it, so they
 * cannot drift apart.
 *
 * Kept free of `server-only` and of any React import: the redirect config reads
 * it at build time and the client nav reads it in the browser.
 */
export interface Tab {
  key: string;
  href: string;
  label: string;
  /** Section anchors within the tab. The design shows these as a second row. */
  sub: Array<{ label: string; anchor: string }>;
  /** Old routes this tab took over. */
  absorbs: string[];
  /** The design hides the range selector on Forecast — a quarter is not a range. */
  showRange: boolean;
}

export const TABS: Tab[] = [
  {
    key: 'monitor',
    href: '/',
    label: 'Monitor',
    sub: [
      { label: 'Read', anchor: 'read' },
      { label: 'What changed', anchor: 'what-changed' },
      { label: 'Reach vs price', anchor: 'reach-vs-price' },
      { label: 'Events', anchor: 'events' },
    ],
    absorbs: ['/signals', '/events', '/ops', '/stock'],
    showRange: true,
  },
  {
    key: 'explain',
    href: '/explain',
    label: 'Explain',
    sub: [
      { label: 'Attribution', anchor: 'attribution' },
      { label: 'Lead-lag', anchor: 'lead-lag' },
      { label: 'Channels', anchor: 'channels' },
      // The design's fourth Explain item was 'Videos'. There is no video-list
      // surface in the data — only video-level inputs to catalogue decay — so
      // this names what actually exists rather than linking to nothing.
      { label: 'Catalogue', anchor: 'catalogue' },
    ],
    absorbs: ['/channels', '/correlation', '/growth', '/analysis'],
    showRange: true,
  },
  {
    key: 'forecast',
    href: '/forecast',
    label: 'Forecast',
    sub: [
      { label: 'Nowcast', anchor: 'nowcast' },
      { label: 'Filed actuals', anchor: 'filed-actuals' },
      { label: 'Track record', anchor: 'track-record' },
    ],
    absorbs: ['/nowcast', '/drivers'],
    showRange: false,
  },
  {
    key: 'evidence',
    href: '/evidence',
    label: 'Evidence',
    sub: [
      { label: 'Correlation', anchor: 'correlation' },
      { label: 'Coverage', anchor: 'coverage' },
      { label: 'Method', anchor: 'method' },
    ],
    absorbs: ['/explore', '/data', '/market'],
    showRange: true,
  },
];

/*
 * The design's range strip is 1M / 3M / 6M / YTD / 1Y / 5Y / All, which is
 * exactly lib/stock-range.ts's StockRange set and labels. Reused rather than
 * redeclared so the two cannot drift into disagreement.
 */

/** Every retired route, paired with the tab that absorbed it. */
export const REDIRECTS: Array<{ source: string; destination: string }> = TABS.flatMap((t) =>
  t.absorbs.map((source) => ({ source, destination: t.href })),
);

export function tabForPath(pathname: string): Tab {
  // Longest href first so '/explain' is not shadowed by '/'.
  const match = [...TABS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => (t.href === '/' ? pathname === '/' : pathname.startsWith(t.href)));
  return match ?? TABS[0];
}
