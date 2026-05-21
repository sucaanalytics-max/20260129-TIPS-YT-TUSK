import type { CandidateSourceChannel } from '@/lib/queries';

/**
 * Candidate Topic channels surfaced by UGC discovery.
 *
 * These are master-audio source channels that drive UGC for our catalog but
 * aren't yet in our dim_channel set. Today's discovery surfaced GowraHari
 * and Jyotica Tangri this way; over time the list grows as the cron sees
 * more attribution data.
 *
 * Action: if a candidate has many UGCs pointing to it and the observed
 * artists clearly belong to TIPS or Saregama catalog, add to dim_channel
 * + dim_artist_label so future runs catalog-match against it.
 */
export function CandidateTopicChannels({
  candidates,
}: {
  candidates: CandidateSourceChannel[];
}) {
  if (candidates.length === 0) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no candidate source channels — all observed master-audio channels are tracked
      </div>
    );
  }
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <header className="border-border border-b px-4 py-3">
        <p className="text-muted-foreground text-xs">
          master-audio source channels that drive UGC for our catalog but aren&apos;t in
          <code className="bg-muted/30 mx-1 rounded px-1 text-[10px]">dim_channel</code>.
          High counts are good additions to track.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Channel</th>
            <th className="px-4 py-3 text-right">UGCs</th>
            <th className="px-4 py-3">Observed artists</th>
            <th className="px-4 py-3">Observed songs</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.channel_id} className="border-border/40 hover:bg-muted/20 border-b last:border-0">
              <td className="px-4 py-2">
                <a
                  href={`https://www.youtube.com/channel/${c.channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground hover:underline"
                >
                  {c.channel_name ?? c.channel_id}
                </a>
                <div className="text-muted-foreground/60 font-mono text-[10px]">{c.channel_id}</div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {c.ugc_pointing_here}
              </td>
              <td className="text-muted-foreground px-4 py-2 text-xs">
                {c.observed_artists.slice(0, 3).join(', ')}
                {c.observed_artists.length > 3 ? ` +${c.observed_artists.length - 3}` : ''}
              </td>
              <td className="text-muted-foreground px-4 py-2 text-xs">
                {c.observed_songs.slice(0, 2).join(', ')}
                {c.observed_songs.length > 2 ? ` +${c.observed_songs.length - 2}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
