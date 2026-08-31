'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';

/**
 * Four sections, not twelve links.
 *
 * The old nav listed every page flat, which made a raw-series page look as
 * important as the answer. These follow the structure the design settled on:
 * Level 0 is the estimate, Level 1 is what moved it, Level 2 is the evidence
 * underneath, and Ops is the health of the pipe that feeds all three.
 *
 * `owns` lists the routes that belong to a section so a deep page still lights
 * up its parent — /channels is Evidence even though it is not under /evidence.
 */
const SECTIONS = [
  { href: '/', label: 'Nowcast', owns: [] as string[] },
  { href: '/drivers', label: 'Drivers', owns: ['/signals', '/growth'] },
  {
    href: '/evidence',
    label: 'Evidence',
    owns: ['/explore', '/analysis', '/channels', '/market', '/stock', '/data', '/correlation', '/events'],
  },
  { href: '/ops', label: 'Ops', owns: [] as string[] },
];

export function Masthead() {
  const pathname = usePathname();

  const isActive = (href: string, owns: string[]) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`) || owns.some((p) => pathname.startsWith(p));

  return (
    <header className="rule-double bg-background sticky top-0 z-20">
      <div className="mx-auto flex max-w-[1440px] items-baseline justify-between gap-8 px-6 pb-3.5 pt-5 md:px-12">
        <Link href="/" className="font-serif text-[25px] font-bold leading-none tracking-[-0.01em]">
          Tusk{' '}
          <span className="text-muted-foreground text-[22px] font-normal italic">
            catalogue fundamentals
          </span>
        </Link>

        <nav className="flex items-baseline gap-6 md:gap-[26px]">
          {SECTIONS.map((s) => {
            const active = isActive(s.href, s.owns);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'border-accent text-foreground border-b-2 pb-[3px] text-[12.5px]'
                    : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent pb-[3px] text-[12.5px] transition-colors'
                }
              >
                {s.label}
              </Link>
            );
          })}
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{ elements: { avatarBox: 'h-6 w-6' } }}
          />
        </nav>
      </div>
    </header>
  );
}
