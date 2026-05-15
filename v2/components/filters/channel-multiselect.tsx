'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

interface Channel {
  channel_id: string;
  channel_name: string;
  company: string;
}

export function ChannelMultiselect({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selected = new Set(params.get('channels')?.split(',').filter(Boolean) ?? []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const sp = new URLSearchParams(params);
    if (next.size) sp.set('channels', Array.from(next).join(','));
    else sp.delete('channels');
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  return (
    <details className="border-border bg-card text-foreground rounded-lg border text-sm">
      <summary className="cursor-pointer px-4 py-2 font-medium">
        Channels {selected.size > 0 ? <span className="text-muted-foreground">({selected.size})</span> : null}
      </summary>
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto px-4 py-3 lg:grid-cols-3">
        {channels.map((c) => (
          <label key={c.channel_id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.has(c.channel_id)}
              onChange={() => toggle(c.channel_id)}
              disabled={isPending}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs">
              {c.channel_name}{' '}
              <span className="text-muted-foreground">({c.company})</span>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}
