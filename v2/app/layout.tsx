import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { THEME_BOOTSTRAP } from '@/components/shell/theme-toggle';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'TUSK · YT×NSE',
  description:
    'Internal research terminal: YouTube catalogue reach for TIPS Music and Saregama, and the revenue nowcast built from it.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the bootstrap script below sets data-theme on
    // this element before React hydrates, so the server's markup deliberately
    // differs from the client's on this one attribute.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        {/*
          THEME_BOOTSTRAP is a module-level constant with no interpolation and no
          user input — nothing reaches it from a request, a param or the
          database. It has to be inlined and blocking: applying the stored theme
          after hydration renders the page dark and then snaps it to light, and
          this is a chart-heavy dashboard where that flash is genuinely bad.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <Suspense fallback={null}>
          <ClerkShell>{children}</ClerkShell>
        </Suspense>
      </body>
    </html>
  );
}

function ClerkShell({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <Suspense fallback={null}>
        <ShellGate>{children}</ShellGate>
      </Suspense>
    </ClerkProvider>
  );
}

/**
 * Signed-out visitors get the bare page (the sign-in route renders its own
 * layout); signed-in ones get the full two-row shell around it.
 */
async function ShellGate({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  return userId ? <AppShell>{children}</AppShell> : <>{children}</>;
}
