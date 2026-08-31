import { rupeesToCrore, TARGET_LINE_ITEM } from '@/lib/financials';
import type { ReportedFinancialRow } from '@/lib/queries';
import type { TrackRecord } from '@/lib/scoring';

const COMPANY_NAME: Record<string, string> = {
  TIPSMUSIC: 'Tips Music',
  SAREGAMA: 'Saregama · music',
};

const LINE_ITEM_LABEL: Record<string, string> = {
  revenue_from_operations: 'Revenue from operations',
  segment_revenue_music: 'Segment revenue — music',
  segment_revenue_artist_management: 'Segment revenue — artist mgmt',
  segment_revenue_video: 'Segment revenue — video',
  segment_revenue_events: 'Segment revenue — events',
  segment_profit_music: 'Segment profit — music',
};

function crore(n: number): string {
  return rupeesToCrore(n).toFixed(2);
}

/**
 * The filed figures the nowcast is scored against.
 *
 * The confirmed flag is a column rather than a filter: getNowcastHeadline and
 * getTrackRecord both drop unconfirmed rows, so a reader who only saw the
 * filtered set could not tell an unchecked extraction from an absent one. Both
 * are shown, each carrying a word as well as a colour.
 */
export function ReportedFinancialsTable({ rows }: { rows: ReportedFinancialRow[] }) {
  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no reported figures stored — fct_reported_financials is empty, so nothing has been filed
        for the estimate to be scored against
      </div>
    );
  }

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Fiscal</th>
            <th className="px-4 py-3">Line item</th>
            <th className="px-4 py-3 text-right">₹ crore</th>
            <th className="px-4 py-3">Checked</th>
            <th className="px-4 py-3">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.company}-${r.fiscal_label}-${r.line_item}`}
              className="border-border/40 hover:bg-muted/30 border-b last:border-0"
            >
              <td className="px-4 py-2.5 font-medium">{COMPANY_NAME[r.company] ?? r.company}</td>
              <td className="px-4 py-2.5 tabular-nums">{r.fiscal_label}</td>
              <td className="text-muted-foreground px-4 py-2.5">
                {LINE_ITEM_LABEL[r.line_item] ?? r.line_item}
                {TARGET_LINE_ITEM[r.company] === r.line_item ? (
                  <span className="text-muted-foreground/70 ml-2 text-xs uppercase tracking-wider">
                    scored
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{crore(r.value_inr)}</td>
              <td className={`px-4 py-2.5 text-xs ${r.confirmed ? 'text-good' : 'text-warning'}`}>
                {r.confirmed ? '✓ confirmed' : '⚠ unconfirmed'}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {r.source_url ? (
                  <a
                    className="text-info hover:underline"
                    href={r.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    filing ↗
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The only reason to believe the estimate above.
 *
 * When nothing has been scored this panel does NOT quietly render an empty
 * table — an empty table reads as "no misses". It says plainly that the model
 * is unproven, because an unscored estimate and a good one look identical on
 * the page and only this panel distinguishes them.
 */
export function TrackRecordPanel({
  records,
}: {
  records: Array<{ company: string; label: string; track: TrackRecord }>;
}) {
  const scored = records.filter((r) => r.track.n > 0);

  if (scored.length === 0) {
    return (
      <div className="border-border bg-card rounded-lg border p-6 text-sm">
        <p className="text-warning font-medium">⚠ No estimate has been scored yet.</p>
        <p className="text-muted-foreground mt-2 max-w-[80ch] leading-relaxed">
          The nowcast has never been checked against a printed result, so it carries no accuracy
          record and should not be relied on. From the first scored quarter this table shows
          quarters scored, how often the actual landed inside the band, the median absolute error
          and the worst miss. Until then the honest reading is that this is a hypothesis with a
          number attached.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3 text-right">Quarters scored</th>
            <th className="px-4 py-3 text-right">Inside the band</th>
            <th className="px-4 py-3 text-right">Median abs. error</th>
            <th className="px-4 py-3">Worst miss</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.company} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
              <td className="px-4 py-2.5 font-medium">{r.label}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.track.n}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.track.hitRate === null ? '—' : `${(r.track.hitRate * 100).toFixed(0)}%`}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {r.track.medianAbsPctError === null
                  ? '—'
                  : `${r.track.medianAbsPctError.toFixed(1)}%`}
              </td>
              <td className="text-muted-foreground px-4 py-2.5 text-xs">
                {r.track.worst
                  ? `${r.track.worst.fiscalLabel} — estimated ₹${crore(
                      r.track.worst.estimate.mid,
                    )}cr, printed ₹${crore(r.track.worst.actual)}cr`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
