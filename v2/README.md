# Tusk · TIPS YT × Stock — v2

Standalone, internal-only research dashboard correlating Tips Industries' YouTube catalogue (Tips Official + sub-channels) with NSE TIPSMUSIC equity price. Saregama tracked as comparator. Designed to replace the public v1 dashboard at `tips-yt-tusk.vercel.app` and the half-finished Social Blade pipeline in `../api/`.

This directory is **separate from v1**: its own `package.json`, its own Vercel deployment, its own (recommended) Supabase project, its own auth.

---

## Stack

- **Next.js 16** (App Router, Cache Components, RSC-first)
- **TypeScript** (strict), Tailwind v3, Recharts
- **Clerk** for auth — non-`/api/cron/*` routes require a Clerk session AND an allowlisted email domain (default `tuskinvest.com`)
- **Supabase Postgres** — accessed via the **service-role key, server-side only**. No anon key in the browser bundle.
- **Vercel Cron** drives daily ingestion (YouTube Data API v3, Yahoo/NSE for stocks)

---

## Directory layout

```
v2/
├── app/
│   ├── api/cron/                  # daily ingestion handlers (Vercel cron)
│   │   ├── youtube-channels/      # channel-day facts from YT Data API v3
│   │   ├── youtube-videos/        # per-video daily facts (last ~90d)
│   │   ├── stocks/                # NSE OHLCV via Yahoo/NSE
│   │   ├── corporate-actions/     # stub — wire NSE actions feed here
│   │   └── health/                # daily green/red, optional Slack alert
│   ├── sign-in/                   # Clerk hosted
│   ├── sign-up/                   # Clerk hosted
│   ├── layout.tsx                 # ClerkProvider + Tailwind
│   ├── page.tsx                   # Overview (KpiGrid + FreshnessBadge)
│   └── globals.css
├── components/
│   ├── kpi-grid.tsx
│   └── freshness-badge.tsx
├── lib/
│   ├── env.ts                     # zod-validated env
│   ├── supabase/server.ts         # service-role client (server-only)
│   ├── youtube.ts                 # YT Data API v3 wrapper
│   ├── stocks.ts                  # Yahoo + NSE
│   ├── fetch-with-retry.ts        # 429/5xx backoff
│   ├── cron-auth.ts               # Bearer CRON_SECRET gate
│   └── queries.ts                 # server-only data layer
├── db/migrations/
│   ├── 0001_baseline.sql          # dim_/fct_/raw_/ops_ tables, RLS locked
│   └── 0002_views.sql             # v_company_daily, v_returns_join (log-returns)
├── middleware.ts                  # Clerk auth + email-domain allowlist
├── vercel.json                    # cron schedule
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .env.example
```

---

## Setup

### 1. Provision a new Supabase project

The recommended path is a **brand-new Supabase project** so v2 starts from a clean baseline (the v1 DB has 16 undocumented views, 3 wide-open `FOR ALL TO authenticated` RLS policies, and a separate undocumented writer pumping `daily_stats` daily — see `../.claude/plans/consider-yourself-an-expert-abundant-creek.md`).

```bash
# install the CLI if you don't have it
brew install supabase/tap/supabase
# from this directory
supabase login
supabase projects create tusk-yt-v2 --org <your-org> --region ap-south-1 \
  --db-password '<random-strong-password>'
supabase link --project-ref <new-project-ref>
```

Then apply the baseline:

```bash
psql "$(supabase status --output env | grep -E '^DB_URL=' | cut -d= -f2-)" \
  -f db/migrations/0001_baseline.sql \
  -f db/migrations/0002_views.sql
```

(or paste into Supabase SQL Editor if you prefer.)

### 2. Seed `dim_channel`

A one-shot seed script lives at `../api/seed-channels.js` (for v1). Adapt or re-paste the channel UCxxxxxx list here. v2's `dim_channel` has a richer shape (`language`, `is_primary`, `uploads_playlist_id`) — the `uploads_playlist_id` will be auto-populated by the first run of `/api/cron/youtube-channels`.

### 3. Provision a Clerk app

`https://dashboard.clerk.com` → new app → "Email link" only → restrict sign-up to `tuskinvest.com` if you want belt-and-braces. Copy the publishable and secret keys.

### 4. Get a YouTube Data API v3 key

`https://console.cloud.google.com` → new project → enable "YouTube Data API v3" → create an API key. The default 10,000 units/day quota is far more than v2 needs (~80 units/day for 38 channels including videos).

### 5. Wire env vars

Local dev:

```bash
cp .env.example .env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (openssl rand -hex 32),
# YOUTUBE_API_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY
```

Vercel:

```bash
vercel link        # new project — do NOT reuse the tips-yt-tusk project
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production
vercel env add YOUTUBE_API_KEY production
vercel env add CLERK_SECRET_KEY production
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
# optional
vercel env add SLACK_ALERT_WEBHOOK_URL production
```

### 6. Run locally

```bash
npm install
npm run dev
# http://localhost:3000 — redirects to /sign-in
```

### 7. Deploy

```bash
vercel deploy --prod
```

Vercel auto-registers cron jobs from `vercel.json`. Verify schedules under the project's "Cron Jobs" tab.

---

## Cron schedule (UTC)

| Path                                | Schedule           | Why this clock                           |
| ----------------------------------- | ------------------ | ---------------------------------------- |
| `/api/cron/youtube-channels`        | `30 0 * * *`       | 06:00 IST — after YouTube daily rollups  |
| `/api/cron/youtube-videos`          | `0 1 * * *`        | 06:30 IST — chained after channels       |
| `/api/cron/stocks`                  | `30 10 * * 1-5`    | 16:00 IST — 30 min after NSE close       |
| `/api/cron/corporate-actions`       | `0 11 * * 1-5`     | 16:30 IST — after NSE publishes actions  |
| `/api/cron/health`                  | `0 12 * * *`       | 17:30 IST — once everything has fired    |

---

## Audit trail

Every cron invocation opens a row in `ops_ingest_run` (`status: 'running'` → `'ok' | 'partial' | 'failed'`) and stores `detail` JSONB with counts, errors, and the `ingest_run_id` is carried into every fact row inserted in that run. Failures additionally land in `ops_error_log`. To inspect the last 24h of activity:

```sql
SELECT source, status, started_at, ended_at, rows_in, rows_out, detail
FROM ops_ingest_run
WHERE started_at > NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

---

## Adding a new dashboard section

1. Add a query to `lib/queries.ts` (server-only).
2. Add a presentational React Server Component in `components/`.
3. Compose into `app/page.tsx` (or a new route). Use `'use cache'` + `cacheTag` + `cacheLife` for expensive queries; revalidate via `updateTag` from the relevant cron route after ingest succeeds.
4. Update this README.

---

## What v2 deliberately does NOT do (yet)

- **No Social Blade.** YT Data API v3 is the only source for channel stats. (Social Blade kept as `../api/update-youtube-stats.js` deprecated stub for emergency fallback.)
- **No anon Supabase reads.** Everything goes through Route Handlers using the service-role key.
- **No public dashboard.** Internal Tusk only. Public visitors hit `/sign-in`.
- **No event-study or backtest panels yet** — schema is ready (`dim_event`, log-return view); UI lands once baseline data is flowing.

---

## Relationship to v1

v1 (in this repo's root) is left running so the legacy dashboard stays up while v2 is built and validated. Cutover plan:

1. v2 collects data in parallel for ≥7 days.
2. Spot-check 5 random `(channel, date)` pairs: v2 `fct_channel_daily` vs YouTube Studio vs v1 `daily_stats`. All three should agree within 1%.
3. Once green: flip the `tips-yt-tusk.vercel.app` domain to the v2 deployment, archive `../index.html` as `legacy.html`, decommission v1 crons.
