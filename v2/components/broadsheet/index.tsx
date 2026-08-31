/**
 * The Broadsheet kit — the shared vocabulary every screen is built from.
 *
 * These are presentational only: no data fetching, no client hooks, so they
 * render inside server components without forcing a boundary. The measurements
 * are lifted from the design artboards verbatim (10.5px eyebrows at 0.06em,
 * 9px table cell padding, the 3px double rule) rather than rounded to a grid —
 * the type sizes are deliberately odd because the page is set like print.
 */
import type { ReactNode } from 'react';

/** Small-caps label. Used for column heads, stat labels and section kickers. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-muted-foreground text-[10.5px] uppercase tracking-eyebrow ${className}`}>
      {children}
    </div>
  );
}

/**
 * The head of a page. `kicker` names where you are in the hierarchy, so a
 * reader landing deep can tell evidence from the answer without going back up.
 */
export function PageHead({
  title,
  kicker,
  standfirst,
}: {
  title: string;
  kicker?: string;
  standfirst?: string;
}) {
  return (
    <div className="mb-6">
      <div className="rule-double flex items-baseline justify-between gap-6 pb-3">
        <h1 className="font-serif text-2xl font-bold tracking-[-0.01em]">{title}</h1>
        {kicker ? (
          <span className="text-muted-foreground text-[11px] uppercase tracking-[0.08em]">
            {kicker}
          </span>
        ) : null}
      </div>
      {standfirst ? (
        <p className="text-muted-foreground mt-3 max-w-[90ch] font-serif text-sm italic">
          {standfirst}
        </p>
      ) : null}
    </div>
  );
}

/** A section break inside a page. The double rule is the page's main rhythm. */
export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="rule-double mt-10 flex items-baseline justify-between gap-6 pb-0">
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      {note ? (
        <span className="text-muted-foreground font-serif text-xs italic">{note}</span>
      ) : null}
    </div>
  );
}

/**
 * A headline number. `unit` rides small and muted beside it so the figure keeps
 * its weight — "₹112–128cr" reads as one number, not a number and a word.
 */
export function Figure({
  value,
  unit,
  size = 'lg',
  tone = 'default',
}: {
  value: string;
  unit?: string;
  size?: 'lg' | 'md' | 'sm';
  tone?: 'default' | 'good' | 'bad' | 'muted';
}) {
  const sizes = {
    lg: 'text-[60px] leading-[1.05] tracking-[-0.025em]',
    md: 'text-2xl',
    sm: 'text-lg',
  }[size];
  const unitSizes = { lg: 'text-[26px]', md: 'text-sm', sm: 'text-xs' }[size];
  const tones = {
    default: '',
    good: 'text-[#2E6B3E]',
    bad: 'text-accent',
    muted: 'text-muted-foreground',
  }[tone];

  return (
    <span data-figure className={`font-serif font-semibold ${sizes} ${tones}`}>
      {value}
      {unit ? (
        <span className={`text-muted-foreground font-normal ${unitSizes}`}>{unit}</span>
      ) : null}
    </span>
  );
}

/** Label-over-figure pair. The unit of the stat rows under each headline. */
export function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'good' | 'bad' | 'muted';
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-[3px]">
        <Figure value={value} unit={unit} size="md" tone={tone} />
      </div>
    </div>
  );
}

/**
 * A bordered note. `caution` is the amber treatment reserved for statements
 * about what the numbers do NOT support — an unproven model, a broken
 * comparison. It is deliberately loud: these are the notes that stop someone
 * trading on a figure that has not earned it.
 */
export function Callout({
  title,
  children,
  tone = 'caution',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'caution' | 'neutral';
}) {
  const tones = {
    caution: 'border-[#C9A227] bg-[#FDF8E8]',
    neutral: 'border-border bg-muted',
  }[tone];

  return (
    <div className={`mt-4 border p-[18px_20px] ${tones}`}>
      {title ? <div className="font-serif text-[17px] font-semibold">{title}</div> : null}
      <div className="mt-[7px] max-w-[96ch] text-[13.5px] leading-relaxed text-[#4A463A]">
        {children}
      </div>
    </div>
  );
}

/** How far through the quarter we are. Plain, because it is a fact, not a gauge. */
export function ProgressRule({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="bg-muted relative mt-5 h-[5px]"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Quarter elapsed"
    >
      <div className="bg-foreground absolute left-0 top-0 h-[5px]" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/* ---- table ---------------------------------------------------------------
 * Figures are right-aligned and tabular; only the first column (the label —
 * a date, a channel, a quarter) reads left. That is the whole rule.
 */

export function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Wide tables scroll inside their own box; the page body never scrolls sideways.
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

export function Th({
  children,
  left = false,
  className = '',
}: {
  children: ReactNode;
  left?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`text-muted-foreground border-foreground border-b py-[9px] text-[10.5px] font-medium uppercase tracking-eyebrow ${
        left ? 'text-left' : 'text-right'
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  left = false,
  flag = false,
  className = '',
}: {
  children: ReactNode;
  left?: boolean;
  /** Marks a figure worth a second look — an outlier, an inferred value. */
  flag?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-border/60 border-b py-[9px] text-[13.5px] ${
        left ? 'text-left' : 'text-right'
      } ${flag ? 'text-accent' : ''} ${className}`}
    >
      {children}
    </td>
  );
}
