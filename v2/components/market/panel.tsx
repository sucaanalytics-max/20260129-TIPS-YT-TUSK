/**
 * Shared chrome for the /market demand-layer strips.
 *
 * Every panel on this page can legitimately be empty: migrations 0022-0025 may
 * not be pushed yet, and the app/chart crons only start accumulating once
 * deployed. An empty panel therefore explains WHY it is empty rather than
 * rendering a blank card or, worse, a confident zero.
 */
export function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-foreground text-sm font-medium">{title}</h3>
          {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
        </div>
        {right}
      </header>
      {children}
    </div>
  );
}

/** Explains an empty panel instead of showing a blank card or a false zero. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground/80 text-xs">{children}</p>;
}

/** Provenance pill — every sector figure on this page carries its source. */
export function SourcePill({
  source,
  url,
  confidence,
}: {
  source: string;
  url?: string | null;
  confidence?: string;
}) {
  const label = confidence && confidence !== 'reported' ? `${source} · ${confidence}` : source;
  const cls =
    confidence === 'forecast'
      ? 'bg-violet-500/15 text-violet-300'
      : confidence === 'estimate'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-muted/30 text-muted-foreground';
  const pill = (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${cls}`}>{label}</span>
  );
  if (!url) return pill;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
      {pill}
    </a>
  );
}

/** Compact count formatter — 14,400,000 → "14.4m", 6e12 → "6.0tn". */
export function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}tn`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}bn`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-IN');
}

/** Signed formatter for deltas so a flat 0 reads differently from "no data". */
export function fmtSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${fmtCount(n)}`;
}
