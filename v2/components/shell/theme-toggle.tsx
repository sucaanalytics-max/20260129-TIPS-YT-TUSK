'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

/**
 * The design ships both themes and a toggle in the header.
 *
 * The choice is written to `document.documentElement.dataset.theme`, which is
 * where every token in globals.css is scoped from, and mirrored to
 * localStorage. A blocking script in the layout applies the stored value before
 * first paint — without it the page renders dark then snaps to light, and on a
 * dashboard full of charts that flash is genuinely unpleasant.
 *
 * Rendering is deferred until after mount because the server cannot know the
 * stored preference; committing to a label during SSR would produce a
 * hydration mismatch on every light-mode load.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || 'dark';
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('tusk-theme', next);
    } catch {
      // Private browsing, or storage disabled. The toggle still works for this
      // page view; it simply will not be remembered. Not worth surfacing.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-ink2 border-border h-[30px] rounded-lg border bg-transparent px-[11px] font-mono text-[11px]"
      // Reserve the width so the header does not shift when the label flips.
      style={{ minWidth: 58 }}
    >
      {theme === null ? '' : theme === 'dark' ? 'LIGHT' : 'DARK'}
    </button>
  );
}

/**
 * Runs before paint. Kept as a string so it can be inlined in the document
 * head; anything imported here would arrive too late to prevent the flash.
 */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('tusk-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;
