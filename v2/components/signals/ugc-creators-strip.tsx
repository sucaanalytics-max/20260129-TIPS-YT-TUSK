import type { UGCCreatorRow } from '@/lib/queries';

/**
 * Side-by-side panel of top UGC creators per company. Surfaces the
 * influencer-tier accounts driving Content-ID-confirmed UGC for each
 * label — useful for partnership/marketing decisions and for spotting
 * accounts that repeatedly source from the label's catalog.
 */
export function UGCCreatorsStrip({
  byCompany,
}: {
  byCompany: Array<{ company: string; creators: UGCCreatorRow[] }>;
}) {
  const totalCreators = byCompany.reduce((acc, c) => acc + c.creators.length, 0);
  if (totalCreators === 0) {
    return null;
  }
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3">
        <h3 className="text-foreground text-sm font-medium">
          Top UGC creators by catalog reach
        </h3>
        <p className="text-muted-foreground text-xs">
          channels driving Content-ID-confirmed UGC for each label · latest snapshot
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {byCompany.map(({ company, creators }) => (
          <div key={company} className="border-border/40 rounded-md border p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-foreground text-xs font-semibold tracking-tight">
                {company}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {creators.length} creator{creators.length === 1 ? '' : 's'}
              </span>
            </div>
            {creators.length === 0 ? (
              <p className="text-muted-foreground/60 text-[10px]">
                no Content-ID-confirmed UGC creators in this snapshot
              </p>
            ) : (
              <ul className="space-y-1.5">
                {creators.slice(0, 5).map((c) => (
                  <li key={c.channel_id} className="text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <a
                        href={`https://www.youtube.com/channel/${c.channel_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:text-foreground truncate underline-offset-2 hover:underline"
                        title={c.channel_name ?? c.channel_id}
                      >
                        @{(c.channel_name ?? c.channel_id).slice(0, 32)}
                        {(c.channel_name ?? c.channel_id).length > 32 ? '…' : ''}
                      </a>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {fmtBig(c.ugc_views_sum)}
                      </span>
                    </div>
                    <div className="text-muted-foreground/70 text-[10px]">
                      {c.ugc_count} Short{c.ugc_count === 1 ? '' : 's'} · {c.distinct_songs}{' '}
                      song{c.distinct_songs === 1 ? '' : 's'} · {c.distinct_sources} source
                      {c.distinct_sources === 1 ? '' : 's'}
                      {c.top_song
                        ? ` · top: ${c.top_song.slice(0, 28)}${
                            c.top_song.length > 28 ? '…' : ''
                          }`
                        : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtBig(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}
