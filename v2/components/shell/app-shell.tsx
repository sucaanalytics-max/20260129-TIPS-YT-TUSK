import { Suspense } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { StatusChips, StatusChipsSkeleton } from './status-chips';
import { ThemeToggle } from './theme-toggle';
import { SubNavRow, TabRow } from './top-nav';

/**
 * The two-row sticky header from the handoff design.
 *
 * Row one is identity, the four tabs, live status and the theme toggle. Row two
 * is the current tab's section anchors and the range strip. Both rows are
 * capped at the same 1400px measure as the page content so the header's edges
 * line up with the cards beneath it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-border bg-surface sticky top-0 z-20 border-b">
        <div className="mx-auto flex h-14 max-w-shell items-center justify-between gap-6 px-7">
          <div className="flex min-w-0 items-center gap-7">
            <Link href="/" className="flex flex-shrink-0 items-baseline gap-2 hover:opacity-80">
              <span className="text-ink text-[15px] font-bold tracking-[-0.02em]">TUSK</span>
              <span className="text-muted-foreground font-mono text-[11px] tracking-[0.04em]">
                YT×NSE
              </span>
            </Link>
            <TabRow />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2.5">
            <Suspense fallback={<StatusChipsSkeleton />}>
              <StatusChips />
            </Suspense>
            <ThemeToggle />
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{ elements: { avatarBox: 'h-7 w-7' } }}
            />
          </div>
        </div>

        <SubNavRow />
      </header>

      {children}
    </>
  );
}

/** Page body wrapper: the design's measure, padding and inter-section rhythm. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-shell flex-col gap-gap px-7 pb-16 pt-6">{children}</main>
  );
}

/**
 * A section that the sub-nav can anchor to. The scroll margin clears the 98px
 * sticky header, so following an anchor does not park the heading underneath it.
 */
export function Section({
  id,
  children,
  className = '',
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 110 }} className={className}>
      {children}
    </section>
  );
}

/** Card chrome, repeated on every panel in the design. */
export function Card({
  children,
  className = '',
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  /** Left status rule, used on the two read cards. */
  accent?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div
      className={`border-border bg-surface rounded-card border shadow-card ${className}`}
      style={accent ? { borderLeft: `3px solid rgb(var(--${accent}))` } : undefined}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-border flex flex-wrap items-baseline justify-between gap-3 border-b p-pad">
      <div>
        <h2 className="text-ink m-0 text-[13px] font-semibold uppercase tracking-eyebrow">
          {title}
        </h2>
        {note ? <p className="text-muted-foreground mt-1 text-xs">{note}</p> : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Expand-on-demand disclosure. The design deliberately replaced standing
 * methodology prose with these — the caveat is always reachable, never in the
 * way.
 */
export function Disclose({
  summary,
  children,
  className = '',
}: {
  summary: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={className}>
      <summary className="text-muted-foreground flex items-center gap-[7px] font-mono text-[11px] uppercase tracking-eyebrow">
        <span className="chev inline-block transition-transform duration-150">›</span>
        {summary}
      </summary>
      <p className="text-ink2 mt-2.5 max-w-[78ch] text-xs leading-relaxed">{children}</p>
    </details>
  );
}
