'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  STOCK_RANGES,
  STOCK_RANGE_LABEL,
  type StockRange,
} from '@/lib/stock-range';

export function RangeSelector({ active }: { active: StockRange }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(r: StockRange): string {
    const next = new URLSearchParams(params.toString());
    next.set('range', r);
    return `${pathname}?${next.toString()}`;
  }

  return (
    <div className="border-border bg-card/40 inline-flex rounded-lg border p-0.5">
      {STOCK_RANGES.map((r) => (
        <Link
          key={r}
          href={hrefFor(r)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
            r === active
              ? 'bg-blue-500/15 text-blue-200'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
          prefetch={false}
        >
          {STOCK_RANGE_LABEL[r]}
        </Link>
      ))}
    </div>
  );
}
