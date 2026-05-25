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

  // SocialBlade Matrix API (optional — if absent, the SB cron is no-op)
  SOCIALBLADE_CLIENT_ID: z.string().min(8).optional().or(z.literal('')),
  SOCIALBLADE_TOKEN: z.string().min(20).optional().or(z.literal('')),

  // Stock symbols (CSV)
  STOCK_SYMBOLS: z.string().default('TIPSMUSIC,SAREGAMA'),

  // Market index symbols (Yahoo-style, CSV of name:symbol pairs)
  MARKET_INDEX_SYMBOLS: z
    .string()
    .default('NIFTY_MIDCAP_150:^CRSMID,NIFTY_50:^NSEI'),

  // BSE scrip codes for earnings ingest (CSV of symbol:code pairs)
  BSE_SCRIP_CODES: z
    .string()
    .default('TIPSMUSIC:532375,SAREGAMA:532163'),

  // Optional alerts
  SLACK_ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),

  // For cron-triggered cacheTag revalidation (deployment's own URL).
  // In prod, set to https://<v2-domain>. In dev, http://localhost:3000.
  NEXT_PUBLIC_APP_URL: z.string().url().optional().or(z.literal('')),

  // YouTube CMS / Content Owner Reporting API service account (dormant).
  // When a label provisions a service account with
  // youtubepartner-content-owner-readonly scope and shares the JSON key,
  // paste the full single-line JSON into this env var. The
  // /api/cron/cms-reporting route auto-engages when this is set;
  // until then it no-ops cleanly.
  // YT_CMS_CONTENT_OWNER_IDS pairs companies to their Content Owner IDs,
  // CSV format: "TIPSMUSIC:abc123def,SAREGAMA:xyz789ghi"
  YT_CMS_SERVICE_ACCOUNT_JSON: z.string().optional().or(z.literal('')),
  YT_CMS_CONTENT_OWNER_IDS: z.string().optional().or(z.literal('')),
});

export const env = Schema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  SOCIALBLADE_CLIENT_ID: process.env.SOCIALBLADE_CLIENT_ID,
  SOCIALBLADE_TOKEN: process.env.SOCIALBLADE_TOKEN,
  STOCK_SYMBOLS: process.env.STOCK_SYMBOLS,
  MARKET_INDEX_SYMBOLS: process.env.MARKET_INDEX_SYMBOLS,
  BSE_SCRIP_CODES: process.env.BSE_SCRIP_CODES,
  SLACK_ALERT_WEBHOOK_URL: process.env.SLACK_ALERT_WEBHOOK_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  YT_CMS_SERVICE_ACCOUNT_JSON: process.env.YT_CMS_SERVICE_ACCOUNT_JSON,
  YT_CMS_CONTENT_OWNER_IDS: process.env.YT_CMS_CONTENT_OWNER_IDS,
});

/**
 * Per-company Content Owner ID lookup. Populated only when at least one
 * label has provisioned CMS access. Empty otherwise.
 */
export const cmsContentOwnerIds = (env.YT_CMS_CONTENT_OWNER_IDS ?? '')
  .split(',')
  .map((pair) => {
    const [company, owner] = pair.split(':').map((s) => s.trim());
    return { company, content_owner_id: owner };
  })
  .filter((p) => p.company && p.content_owner_id);

export const stockSymbols = env.STOCK_SYMBOLS
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export const marketIndexSymbols = env.MARKET_INDEX_SYMBOLS
  .split(',')
  .map((pair) => {
    const [name, symbol] = pair.split(':').map((s) => s.trim());
    return { name, symbol };
  })
  .filter((p) => p.name && p.symbol);

export const bseScripCodes = env.BSE_SCRIP_CODES
  .split(',')
  .map((pair) => {
    const [symbol, code] = pair.split(':').map((s) => s.trim());
    return { symbol, code };
  })
  .filter((p) => p.symbol && p.code);
