import { Suspense } from 'react';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Masthead } from '@/components/nav';
import './globals.css';

const serif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  // Optical sizing matters here: the 60px nowcast figure and the 11px eyebrow
  // are the same family, and without it the small sizes go spindly.
  axes: ['opsz'],
});
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Tusk · catalogue fundamentals',
  description:
    'Internal research desk: a revenue nowcast for TIPS Music and Saregama, and the catalogue reach it is built from.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
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
        <NavGate />
      </Suspense>
      {children}
    </ClerkProvider>
  );
}

async function NavGate() {
  const { userId } = await auth();
  return userId ? <Masthead /> : null;
}
