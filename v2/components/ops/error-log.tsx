import type { OpsErrorRow } from '@/lib/queries';

export function ErrorLog({ errors }: { errors: OpsErrorRow[] }) {
  if (!errors.length) {
    return (
      <div className="border-border bg-card text-emerald-400 rounded-lg border p-6 text-sm">
        no errors in window — pipeline clean
      </div>
    );
  }
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Message</th>
            <th className="px-4 py-3 text-right">Run</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={e.id} className="border-border/40 border-b last:border-0">
              <td className="text-muted-foreground px-4 py-2 text-xs">{e.created_at.replace('T', ' ').slice(0, 19)}</td>
              <td className="px-4 py-2 text-xs font-mono text-amber-300">{e.error_type}</td>
              <td className="px-4 py-2 text-xs">{e.error_message.slice(0, 200)}</td>
              <td className="text-muted-foreground px-4 py-2 text-right font-mono text-xs">
                {e.ingest_run_id ? `#${e.ingest_run_id}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
