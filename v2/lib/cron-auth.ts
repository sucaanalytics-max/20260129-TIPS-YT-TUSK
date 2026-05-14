import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Gate any /api/cron/* route. Vercel auto-injects
 *   Authorization: Bearer ${CRON_SECRET}
 * on scheduled invocations. Manual calls require the same header.
 *
 * Usage in a route handler:
 *   const denied = requireCronAuth(req);
 *   if (denied) return denied;
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const header = req.headers.get('authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token || token !== env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }
  return null;
}
