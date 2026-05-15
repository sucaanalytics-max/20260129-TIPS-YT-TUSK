import { clerkClient, clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublic = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/cron/(.*)',
  '/api/stats/(.*)',
  '/api/internal/(.*)',
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

  // Prefer the JWT-claim email (cheap, no extra fetch) when present, but fall
  // back to fetching the user record from Clerk. Clerk's default JWT template
  // does not include `email`, so the claim path is empty until the dashboard's
  // "session" template adds it. The fallback makes the gate work either way.
  let email: string | undefined =
    (sessionClaims?.email as string | undefined) ||
    (sessionClaims?.primary_email_address as string | undefined);

  if (!email) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const primaryId = user.primaryEmailAddressId;
      const primary = user.emailAddresses.find((e) => e.id === primaryId) ?? user.emailAddresses[0];
      email = primary?.emailAddress;
    } catch {
      // fall through — empty email means deny below
    }
  }

  const lowered = email?.toLowerCase();
  const domainOk = lowered && ALLOWED_DOMAINS.some((d) => lowered.endsWith(`@${d}`));
  if (!domainOk) {
    return new NextResponse(
      `Forbidden: account ${email ?? '(no email)'} not authorized. Sign in with @${ALLOWED_DOMAINS[0]}.`,
      { status: 403 },
    );
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)'],
};
