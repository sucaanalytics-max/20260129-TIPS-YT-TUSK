/**
 * Metric identity shared by server queries and client components.
 *
 * Deliberately its own module with no imports: lib/queries.ts is `server-only`,
 * so any runtime value a client component needs cannot live there. Types are
 * erased at compile time and may be imported from queries, but constants like
 * METRIC_LABEL would drag the whole server graph into the browser bundle.
 */

export type ExplorerMetric = 'views' | 'subscribers' | 'releases';

export const METRIC_LABEL: Record<ExplorerMetric, string> = {
  views: 'Views',
  subscribers: 'Subscriber net adds',
  releases: 'Releases',
};
