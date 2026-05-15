'use client';

import { useTransition, useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { PRESET_OPTIONS, type RangePreset } from '@/lib/date-presets';

/**
 * URL-search-param-backed date filter. Renders preset buttons + (when
 * Custom is active) two date inputs. Server components read ?range= and
 * ?from=/?to= via the rangeFromSearchParams helper.
 */
export function DateRangePresets({ defaultPreset = 'last_30d' as RangePreset }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const activePreset = (params.get('range') as RangePreset | null) ?? defaultPreset;
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  // Sync custom-input state when URL params change externally
  useEffect(() => {
    setFrom(params.get('from') ?? '');
    setTo(params.get('to') ?? '');
  }, [params]);

  function applyPreset(preset: RangePreset) {
    const next = new URLSearchParams(params);
    next.set('range', preset);
    if (preset !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function applyCustom() {
    if (!from || !to) return;
    const next = new URLSearchParams(params);
    next.set('range', 'custom');
    next.set('from', from);
    next.set('to', to);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground mr-1">Range:</span>
        {PRESET_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => applyPreset(opt.value)}
            disabled={isPending}
            className={`rounded-md border px-2.5 py-1 transition-colors ${
              activePreset === opt.value
                ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
            } ${isPending ? 'opacity-60' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {activePreset === 'custom' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyCustom();
          }}
          className="flex items-center gap-1.5 text-xs"
        >
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs"
            aria-label="From date"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs"
            aria-label="To date"
          />
          <button
            type="submit"
            disabled={!from || !to || isPending}
            className="rounded-md border border-blue-500 bg-blue-500/20 px-2.5 py-1 text-blue-200 disabled:opacity-40"
          >
            Apply
          </button>
        </form>
      ) : null}
    </div>
  );
}
