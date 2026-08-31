import { formatCrore } from '@/lib/financials';
import type { TrackRecord } from '@/lib/scoring';
import { Callout, Sheet, Td, Th } from '@/components/broadsheet';

/**
 * The only reason to believe the figures above.
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
      <Callout title="No estimate has been scored yet.">
        The nowcast has never been checked against a printed result, so it carries no accuracy
        record and should not be relied on. From the first scored quarter this panel shows every
        past estimate, its error, and whether the actual landed inside the band. Until then the
        honest reading is that this is a hypothesis with a number attached.
      </Callout>
    );
  }

  return (
    <Sheet className="mt-5">
      <thead>
        <tr>
          <Th left>Company</Th>
          <Th>Quarters scored</Th>
          <Th>Inside the band</Th>
          <Th>Median abs. error</Th>
          <Th left className="pl-8">Worst miss</Th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.company}>
            <Td left>{r.label}</Td>
            <Td>{r.track.n}</Td>
            <Td>{r.track.hitRate === null ? '—' : `${(r.track.hitRate * 100).toFixed(0)}%`}</Td>
            <Td>
              {r.track.medianAbsPctError === null
                ? '—'
                : `${r.track.medianAbsPctError.toFixed(1)}%`}
            </Td>
            <Td left className="pl-8">
              {r.track.worst
                ? `${r.track.worst.fiscalLabel} — estimated ${formatCrore(
                    r.track.worst.estimate.mid,
                  )}, printed ${formatCrore(r.track.worst.actual)}`
                : '—'}
            </Td>
          </tr>
        ))}
      </tbody>
    </Sheet>
  );
}
