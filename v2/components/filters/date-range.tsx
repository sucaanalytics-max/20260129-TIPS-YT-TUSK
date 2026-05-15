'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

const PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '1y', days: 365 },
  { label: '2y', days: 730 },
];

export function DateRange({ defaultDays = 180 }: { defaultDays?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const active = (() => {
    const from = params.get('from');
    if (!from) return defaultDays;
    const diff = Math.round((Date.now() - new Date(from + 'T00:00:00Z').getTime()) / 86_400_000);
    const match = PRESETS.find((p) => Math.abs(p.days - diff) < 3);
    return match?.days ?? defaultDays;
  })();

  function apply(days: number) {
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const next = new URLSearchParams(params);
    next.set('from', from);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground mr-2">Range:</span>
      {PRESETS.map((p) => (
        <button
          key={p.days}
          onClick={() => apply(p.days)}
          disabled={isPending}
          className={`rounded-md border px-2.5 py-1 transition-colors ${
            active === p.days
              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
              : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
