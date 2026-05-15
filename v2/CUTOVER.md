# v2 cutover runbook

Run these steps in order to move from the legacy v1 dashboard (root `index.html`
+ root `api/*.js` + Supabase `bfafqccvzboyfjewzvhk`) to v2. Each step is
independently reversible until step 7.

## 0 — Prereqs

- Vercel CLI installed and logged in (`vercel whoami`).
- Supabase CLI installed and logged in (`supabase login`).
- Python 3.13 available locally for stats sanity-checks.
- A test `@tuskinvest.com` Clerk account for verification.

## 1 — Provision the new Supabase project

```bash
supabase projects create tusk-yt-v2 --region ap-south-1 \
  --db-password "$(openssl rand -hex 32)"
# capture the project ref printed
cd v2/
supabase link --project-ref <new-project-ref>
```

Apply migrations in order:

```bash
psql "$DATABASE_URL" \
  -f db/migrations/0001_baseline.sql \
  -f db/migrations/0002_views.sql \
  -f db/migrations/0003_event_dimensions.sql \
  -f db/migrations/0004_stats_tables.sql \
  -f db/migrations/0005_adjusted_close.sql \
  -f db/migrations/0006_refresh_helpers.sql
```

Verify:

```bash
psql "$DATABASE_URL" -c "
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = relnamespace
WHERE n.nspname='public' AND relkind IN ('r','m','v')
ORDER BY relname;"
```

You should see all `dim_*`, `fct_*`, `raw_*`, `ops_*` tables + the `v_*` views
+ `fct_returns_daily` materialized view.

## 2 — Provision Clerk

`https://dashboard.clerk.com` → new app → restrict sign-up to `tuskinvest.com`.
Copy publishable + secret keys.

## 3 — Provision the new Vercel project

**Do NOT reuse the `tips-yt-tusk` project** — v1 must keep running for
parallel-validation. Create a fresh project pointing at `v2/`:

```bash
cd v2/
vercel link
# choose Create new project, name: tusk-yt-v2
```

Set environment variables (Production scope):

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production              # openssl rand -hex 32
vercel env add YOUTUBE_API_KEY production
vercel env add CLERK_SECRET_KEY production
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
vercel env add NEXT_PUBLIC_APP_URL production      # final domain
vercel env add MARKET_INDEX_SYMBOLS production     # default works
vercel env add BSE_SCRIP_CODES production          # default works
vercel env add V1_SUPABASE_URL production
vercel env add V1_SUPABASE_ANON_KEY production
# optional
vercel env add SLACK_ALERT_WEBHOOK_URL production
```

## 4 — Initial deploy

```bash
vercel deploy --prod
```

Wait for build to succeed. Vercel auto-registers the 9 cron schedules from
`vercel.json` (visible under the project's Cron Jobs tab).

## 5 — Seed + first ingest

```bash
# Seed dim_company + dim_channel (idempotent)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<v2-domain>/api/cron/seed

# Force-run each cron once
for path in youtube-channels youtube-videos stocks market-index corporate-actions earnings; do
  echo "→ /api/cron/$path"
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
    "https://<v2-domain>/api/cron/$path" | jq .
done

# Then run Python stats once
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<v2-domain>/api/stats/recompute" | jq .
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<v2-domain>/api/stats/event-study" | jq .

# Health
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<v2-domain>/api/cron/health" | jq .
```

## 6 — Backfill v1 → v2

```bash
cd v2/
# Dry-run first
V1_SUPABASE_URL=https://bfafqccvzboyfjewzvhk.supabase.co \
V1_SUPABASE_ANON_KEY="<v1-anon>" \
SUPABASE_URL="<v2-url>" \
SUPABASE_SERVICE_ROLE_KEY="<v2-service-role>" \
  npx tsx scripts/backfill-from-v1.ts --dry-run

# Then real run
V1_SUPABASE_URL=https://bfafqccvzboyfjewzvhk.supabase.co \
V1_SUPABASE_ANON_KEY="<v1-anon>" \
SUPABASE_URL="<v2-url>" \
SUPABASE_SERVICE_ROLE_KEY="<v2-service-role>" \
  npx tsx scripts/backfill-from-v1.ts
```

Validation queries (spot-check 5 random rows):

```sql
-- Pick 5 random (channel_id, date) pairs from v2
WITH sample AS (
  SELECT channel_id, date
  FROM fct_channel_daily
  WHERE date >= now()::date - 30
  ORDER BY random() LIMIT 5
)
SELECT * FROM fct_channel_daily WHERE (channel_id, date) IN (SELECT channel_id, date FROM sample);
-- Cross-check against v1.youtube_channel_stats for the same pairs.
-- Acceptable drift: 1% on daily_views (CHECK constraints differ slightly).
```

## 7 — Domain cutover (irreversible-ish)

Run in parallel for ≥7 days to validate. Once green:

1. **Rotate v1 anon key** in the legacy Supabase project (Settings → API).
2. **Repoint domain** — in Vercel, move the `tips-yt-tusk.vercel.app` domain
   (or set up `research.tuskinvest.com`) to the new project.
3. **Disable v1 crons** — delete the three crons in `<repo-root>/vercel.json`
   (TIPSMUSIC stock, Saregama stock, YT channels). Push to the v1 project.
4. **Archive v1 HTML** — move `<repo-root>/index.html` to `<repo-root>/legacy/index.html`
   and add a tiny `<repo-root>/api/legacy-410.js` returning 410 Gone. Update
   `<repo-root>/vercel.json` rewrites.
5. **Update top-level README** to point at `v2/` as canonical.

## Rollback

Steps 1–6 are reversible (just stop running v2 crons, the v1 stack keeps
going). Step 7 is reversed by repointing the domain back and re-enabling v1
crons. The legacy v1 Supabase project is retained read-only for one quarter
as audit reference.

## Daily monitoring after cutover

- `/ops` route — quick visual of run-history + recent errors.
- `/api/cron/health` returns 200 daily; on `503` the Slack webhook fires.
- Spot-check `fct_returns_daily` materialized view is being refreshed
  daily by `refresh_fct_returns()` (called inside `/api/stats/recompute`).
