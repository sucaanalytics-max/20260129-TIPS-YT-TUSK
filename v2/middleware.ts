import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublic = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/cron/(.*)',
]);

const ALLOWED_DOMAINS = (process.env.TUSK_ALLOWED_EMAIL_DOMAINS ?? 'tuskinvest.com')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return (await auth()).redirectToSignIn({ returnBackUrl: req.url });
  }

  const email = (sessionClaims?.email as string | undefined)?.toLowerCase();
  const domainOk = email && ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`));
  if (!domainOk) {
    return new NextResponse('Forbidden: account not authorized for Tusk research', {
      status: 403,
    });
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
