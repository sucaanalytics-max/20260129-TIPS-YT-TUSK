import type { ChannelLeaderboardRow } from '@/lib/queries';
import { formatNumber } from '@/lib/queries';

export function ChannelLeaderboard({ rows }: { rows: ChannelLeaderboardRow[] }) {
  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no channel rows — waiting on first /api/cron/youtube-channels run
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => (b.daily_views ?? 0) - (a.daily_views ?? 0));

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Channel</th>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Lang</th>
            <th className="px-4 py-3 text-right">Subs</th>
            <th className="px-4 py-3 text-right">Total views</th>
            <th className="px-4 py-3 text-right">Daily views</th>
            <th className="px-4 py-3 text-right">Δ subs</th>
            <th className="px-4 py-3 text-right">Δ videos</th>
            <th className="px-4 py-3">As of</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.channel_id} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
              <td className="px-4 py-2.5 font-medium">{r.channel_name}</td>
              <td className="text-muted-foreground px-4 py-2.5">{r.company}</td>
              <td className="text-muted-foreground px-4 py-2.5">{r.language ?? '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.subscribers)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.total_views)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.daily_views)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.daily_subscribers)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.daily_videos)}</td>
              <td className="text-muted-foreground px-4 py-2.5 text-xs">{r.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
