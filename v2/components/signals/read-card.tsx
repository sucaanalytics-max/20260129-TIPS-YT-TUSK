import type { Read } from '@/lib/signals';

const BIAS_STYLES: Record<Read['bias'], { border: string; bg: string; text: string; dot: string }> = {
  POSITIVE: {
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/5',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  MIXED: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  NEGATIVE: {
    border: 'border-red-500/40',
    bg: 'bg-red-500/5',
    text: 'text-red-300',
    dot: 'bg-red-400',
  },
};

export function ReadCard({
  company,
  read,
  asOf,
}: {
  company: string;
  read: Read;
  asOf: string | null;
}) {
  const style = BIAS_STYLES[read.bias];
  return (
    <article
      className={`rounded-lg border p-4 ${style.border} ${style.bg}`}
      aria-label={`Read for ${company}`}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-foreground text-xs font-medium uppercase tracking-wider">
            Read · {company}
          </span>
          {asOf ? (
            <span className="text-muted-foreground text-xs">as of {asOf}</span>
          ) : null}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wider ${style.border} ${style.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {read.bias}
        </span>
      </header>
      <p className="text-foreground text-sm leading-snug">{read.sentence}</p>
      <p className="text-muted-foreground mt-3 text-[10px] uppercase tracking-[0.18em]">
        Internal view · not research
      </p>
    </article>
  );
}
