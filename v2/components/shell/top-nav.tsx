'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { STOCK_RANGES, STOCK_RANGE_LABEL, parseStockRange } from '@/lib/stock-range';
import { TABS, tabForPath } from './nav-model';

/** Tab row. Active tab comes from the route, not from local state. */
export function TabRow() {
  const pathname = usePathname();
  const active = tabForPath(pathname);

  return (
    <nav className="flex items-center gap-0.5">
      {TABS.map((t) => {
        const on = t.key === active.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-lg px-3.5 py-[7px] text-[13px] font-medium tracking-[-0.005em] transition-colors ${
              on ? 'text-accent' : 'text-muted-foreground hover:text-ink2'
            }`}
            // accentSoft: the design tints it differently per theme (.14 dark,
            // .10 light), so the alpha is a token rather than a fixed class.
            style={on ? { background: 'rgb(var(--accent) / var(--accent-soft-a))' } : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Second header row: section anchors for the current tab, plus the range strip.
 *
 * In the prototype these sub-items were decorative — they moved an index and
 * changed nothing. Here they are real anchors into the sections below, and the
 * underline follows whichever section is actually on screen, so the row reports
 * position rather than merely offering navigation.
 */
export function SubNavRow() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabForPath(pathname);
  const range = parseStockRange(params.get('range') ?? undefined);
  const [activeAnchor, setActiveAnchor] = useState<string>(tab.sub[0]?.anchor ?? '');

  useEffect(() => {
    setActiveAnchor(tab.sub[0]?.anchor ?? '');
    const sections = tab.sub
      .map((s) => document.getElementById(s.anchor))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // rootMargin pulls the trigger line down under the 98px sticky header so a
    // section counts as "current" when it reaches the top of the readable area,
    // not when it touches the viewport edge behind the header.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveAnchor(visible.target.id);
      },
      { rootMargin: '-98px 0px -55% 0px', threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);

  function setRange(next: string) {
    const q = new URLSearchParams(params.toString());
    q.set('range', next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="border-border mx-auto flex h-[42px] max-w-shell items-center gap-[18px] overflow-x-auto border-t px-7">
      {tab.sub.map((s) => {
        const on = s.anchor === activeAnchor;
        return (
          <a
            key={s.anchor}
            href={`#${s.anchor}`}
            className={`whitespace-nowrap py-[3px] text-xs tracking-[-0.005em] transition-colors ${
              on ? 'text-ink font-medium' : 'text-muted-foreground hover:text-ink2'
            }`}
            style={on ? { boxShadow: 'inset 0 -2px 0 rgb(var(--accent))' } : undefined}
          >
            {s.label}
          </a>
        );
      })}

      <span className="flex-1" />

      {tab.showRange ? (
        <div
          className="border-border bg-border inline-flex gap-px overflow-hidden rounded-[7px] border"
          role="group"
          aria-label="Time range"
        >
          {STOCK_RANGES.map((r) => {
            const on = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={on}
                className={`cursor-pointer border-0 px-2.5 py-[5px] font-mono text-[11px] ${
                  on ? 'bg-accent text-white' : 'bg-surface text-muted-foreground hover:text-ink2'
                }`}
              >
                {STOCK_RANGE_LABEL[r]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
