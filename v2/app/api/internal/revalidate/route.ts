import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { bumpTags } from '@/lib/revalidate';


/**
 * Internal webhook so the Python stats service can invalidate Next.js
 * cacheTag()s after it lands new derived rows. Same Bearer CRON_SECRET
 * gate as the rest of the cron surface.
 *
 * POST body: { "tags": ["correlation", "events", ...] }
 */
export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  let tags: string[] = [];
  try {
    const body = (await req.json()) as { tags?: unknown };
    if (Array.isArray(body.tags)) {
      tags = body.tags.filter((t): t is string => typeof t === 'string' && t.length > 0);
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (tags.length === 0) {
    return NextResponse.json({ ok: false, error: 'no tags provided' }, { status: 400 });
  }

  bumpTags(...tags);
  return NextResponse.json({ ok: true, bumped: tags });
}
