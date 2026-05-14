import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Server-side Supabase client using the service-role key.
 *
 * NEVER import this from a client component or expose it to the browser.
 * Used by:
 *   - cron route handlers under /api/cron/*
 *   - server components and route handlers that read data on behalf of an
 *     authenticated user (auth gate is enforced by middleware)
 */
export function getServiceSupabase(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
  });
}
