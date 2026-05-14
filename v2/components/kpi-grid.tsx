import type { OverviewData } from '@/lib/queries';

export function KpiGrid({ data }: { data: OverviewData }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {data.kpis.map((k) => (
        <div
          key={k.label}
          className="bg-card border-border rounded-lg border p-4"
        >
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {k.label}
          </p>
          <p className="text-foreground mt-2 text-2xl font-semibold tabular-nums">
            {k.value}
          </p>
          {k.delta ? (
            <p
              className={`mt-1 text-xs tabular-nums ${
                k.delta.startsWith('-') ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {k.delta}
            </p>
          ) : null}
          {k.hint ? (
            <p className="text-muted-foreground mt-1 text-xs">{k.hint}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
