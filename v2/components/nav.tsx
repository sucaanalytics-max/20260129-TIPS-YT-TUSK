'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';

const ITEMS = [
  { href: '/', label: 'Overview' },
  { href: '/signals', label: 'Signals' },
  { href: '/growth', label: 'Growth' },
  { href: '/channels', label: 'Channels' },
  { href: '/correlation', label: 'Correlation' },
  { href: '/events', label: 'Events' },
  { href: '/stock', label: 'Stock' },
  { href: '/data', label: 'Data' },
  { href: '/ops', label: 'Ops' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-border bg-card/40 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-foreground text-sm font-semibold tracking-tight">
            TUSK
            <span className="text-muted-foreground ml-2 font-normal">YT × NSE</span>
          </Link>
          <ul className="flex items-center gap-1">
            {ITEMS.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-blue-500/15 text-blue-200'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <UserButton afterSignOutUrl="/sign-in" appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />
      </div>
    </nav>
  );
}
