/**
 * Pure UGC reach aggregation.
 *
 * Fixes the two double-count traps in the raw getUGCReach sum:
 *  1. It summed every (source_video_id, ugc_video_id) row, so a Short whose
 *     audio maps to multiple catalog anchors was counted once per anchor.
 *     → We dedup by ugc_video_id (validated 0% today, but unguarded).
 *  2. It never excluded first-party Shorts — Shorts posted by the label's OWN
 *     owned/topic channels, whose views are ALREADY in v_company_daily /
 *     getTopicReach. Summing them onto owned/topic double-counts.
 *     → We drop any ugc_video_id whose posting channel ∈ our channels.
 *
 * It also prefers the EXACT cumulative count (dim_ugc_video.latest_view_count,
 * from videos.list — ~99% populated) over the coarse accessibility-text
 * approximation, falling back to the max approx across the video's rows.
 */

export interface UgcMatchRow {
  ugc_video_id: string;
  view_count: number | null; // approximate, parsed from accessibility text
}

export interface UgcVideoMeta {
  channel_id: string | null; // posting channel (for first-party exclusion)
  latest_view_count: number | null; // exact, from videos.list
}

export interface UgcReachAggregate {
  cumulative_views: number;
  shorts_count: number;
  excluded_firstparty: number;
  exact_count: number;
  approx_count: number;
}

export function aggregateUgcReach(
  rows: UgcMatchRow[],
  meta: Map<string, UgcVideoMeta>,
  ourChannelIds: Set<string>,
): UgcReachAggregate {
  // Dedup by ugc_video_id, keeping the max approx view_count across its rows.
  const maxApproxById = new Map<string, number | null>();
  for (const r of rows) {
    const prev = maxApproxById.get(r.ugc_video_id);
    if (prev === undefined) {
      maxApproxById.set(r.ugc_video_id, r.view_count);
    } else if (r.view_count != null && (prev == null || r.view_count > prev)) {
      maxApproxById.set(r.ugc_video_id, r.view_count);
    }
  }

  let cumulative_views = 0;
  let shorts_count = 0;
  let excluded_firstparty = 0;
  let exact_count = 0;
  let approx_count = 0;

  for (const [ugcId, approx] of maxApproxById) {
    const m = meta.get(ugcId);
    // First-party exclusion: a Short posted by one of our own channels is
    // already counted in owned/topic — drop it.
    if (m?.channel_id != null && ourChannelIds.has(m.channel_id)) {
      excluded_firstparty += 1;
      continue;
    }
    shorts_count += 1;
    if (m?.latest_view_count != null) {
      cumulative_views += m.latest_view_count;
      exact_count += 1;
    } else {
      cumulative_views += approx ?? 0;
      approx_count += 1;
    }
  }

  return { cumulative_views, shorts_count, excluded_firstparty, exact_count, approx_count };
}
