import { z } from 'zod';

/**
 * Centralised env access. Throws on missing required vars at first import.
 * Server-only — never import from client components.
 */

const Schema = z.object({
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // Cron auth
  CRON_SECRET: z.string().min(16),

  // YouTube
  YOUTUBE_API_KEY: z.string().min(20),

  // Stock symbols (CSV)
  STOCK_SYMBOLS: z.string().default('TIPSMUSIC,SAREGAMA'),

  // Optional alerts
  SLACK_ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
});

export const env = Schema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  STOCK_SYMBOLS: process.env.STOCK_SYMBOLS,
  SLACK_ALERT_WEBHOOK_URL: process.env.SLACK_ALERT_WEBHOOK_URL,
});

export const stockSymbols = env.STOCK_SYMBOLS
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
