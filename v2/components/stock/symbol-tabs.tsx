'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { type StockSymbolParam, SYMBOL_LABEL } from '@/lib/stock-range';

const ITEMS: StockSymbolParam[] = ['TIPS', 'SARE', 'compare'];

export function SymbolTabs({ active }: { active: StockSymbolParam }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(s: StockSymbolParam): string {
    const next = new URLSearchParams(params.toString());
    next.set('symbol', s);
    return `${pathname}?${next.toString()}`;
  }

  return (
    <div className="border-border bg-card/40 inline-flex rounded-lg border p-0.5">
      {ITEMS.map((s) => (
        <Link
          key={s}
          href={hrefFor(s)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            s === active
              ? 'bg-blue-500/15 text-blue-200'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
          prefetch={false}
        >
          {SYMBOL_LABEL[s]}
        </Link>
      ))}
    </div>
  );
}
