import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { Nav } from '@/components/nav';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Tusk · TIPS YT × Stock',
  description: 'Internal research dashboard correlating YouTube catalogue performance with TIPSMUSIC equity price.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
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
  return userId ? <Nav /> : null;
}
