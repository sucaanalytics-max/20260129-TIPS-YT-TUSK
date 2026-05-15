#!/usr/bin/env bash
# Tusk v2 deploy script. Run from the v2/ directory after `vercel link`.
#
# Prereqs (one-time):
#   1. cd v2/
#   2. vercel link          # interactive — pick "Create new project", name "tusk-yt-v2"
#                           # DO NOT link to the existing tips-yt-tusk project.
#
# Secrets sourcing — in priority order:
#   1. shell env vars (set them before running this script)
#   2. v2/.env.local (loaded via `set -a; source v2/.env.local; set +a`)
#   3. interactive prompt (last resort)
#
# Never hardcode secrets in this file. If you see one, treat it as a leaked
# secret and rotate immediately.

set -euo pipefail

if [ ! -f .vercel/project.json ]; then
  echo "ERROR: no .vercel/project.json — run 'vercel link' first inside v2/."
  echo "       Choose 'Create new project' and name it 'tusk-yt-v2'."
  exit 1
fi

PROJ_NAME=$(jq -r .projectName .vercel/project.json 2>/dev/null || echo "<unknown>")
if [ "$PROJ_NAME" = "tips-yt-tusk" ]; then
  echo "ERROR: This is linked to the v1 project 'tips-yt-tusk'."
  echo "       Run 'rm -rf .vercel && vercel link' and create a new project."
  exit 1
fi
echo "Deploying to Vercel project: $PROJ_NAME"
echo

# ---- non-secret defaults ----------------------------------------------------
# These are project config, not secrets. Safe to live in source.
SUPABASE_URL="${SUPABASE_URL:-https://bfafqccvzboyfjewzvhk.supabase.co}"
STOCK_SYMBOLS="${STOCK_SYMBOLS:-TIPSMUSIC,SAREGAMA}"
MARKET_INDEX_SYMBOLS="${MARKET_INDEX_SYMBOLS:-NIFTY_MIDCAP_150:^CRSMID,NIFTY_50:^NSEI}"
BSE_SCRIP_CODES="${BSE_SCRIP_CODES:-TIPSMUSIC:532375,SAREGAMA:532163}"
TUSK_ALLOWED_EMAIL_DOMAINS="${TUSK_ALLOWED_EMAIL_DOMAINS:-tuskinvest.com}"

# ---- secrets: env > .env.local > prompt -------------------------------------
# Auto-load .env.local if present and any required secret is missing.
if [ -f .env.local ]; then
  if [ -z "${CRON_SECRET:-}" ] || [ -z "${YOUTUBE_API_KEY:-}" ] \
     || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] \
     || [ -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ] \
     || [ -z "${CLERK_SECRET_KEY:-}" ]; then
    echo "Sourcing secrets from .env.local..."
    set -a
    # shellcheck disable=SC1091
    source .env.local
    set +a
  fi
fi

prompt_secret () {
  local var=$1
  local hint=$2
  if [ -z "${!var:-}" ]; then
    echo "  $var needed.  Hint: $hint"
    read -r -s -p "  Paste $var: " value
    echo
    eval "$var=\$value"
  fi
}

prompt_secret CRON_SECRET                    "generate: openssl rand -hex 32"
prompt_secret YOUTUBE_API_KEY                "Google Cloud Console → APIs & Services → Credentials"
prompt_secret SUPABASE_SERVICE_ROLE_KEY      "Supabase dashboard → Settings → API keys → service_role"
prompt_secret NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "Clerk dashboard → API Keys (pk_…)"
prompt_secret CLERK_SECRET_KEY               "Clerk dashboard → API Keys (sk_…)"

push_env () {
  local key=$1
  local value=$2
  echo "$value" | vercel env add "$key" production --force >/dev/null 2>&1 \
    || echo "$value" | vercel env add "$key" production >/dev/null
  echo "  ✓ $key"
}

echo
echo "Pushing env vars to Vercel (production)..."
push_env SUPABASE_URL                  "$SUPABASE_URL"
push_env SUPABASE_SERVICE_ROLE_KEY     "$SUPABASE_SERVICE_ROLE_KEY"
push_env CRON_SECRET                   "$CRON_SECRET"
push_env YOUTUBE_API_KEY               "$YOUTUBE_API_KEY"
push_env STOCK_SYMBOLS                 "$STOCK_SYMBOLS"
push_env MARKET_INDEX_SYMBOLS          "$MARKET_INDEX_SYMBOLS"
push_env BSE_SCRIP_CODES               "$BSE_SCRIP_CODES"
push_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
push_env CLERK_SECRET_KEY              "$CLERK_SECRET_KEY"
push_env TUSK_ALLOWED_EMAIL_DOMAINS    "$TUSK_ALLOWED_EMAIL_DOMAINS"

echo
echo "Deploying to production..."
DEPLOY_URL=$(vercel deploy --prod --yes 2>&1 | tee /dev/stderr | tail -1)

if [[ "$DEPLOY_URL" != https://* ]]; then
  echo "ERROR: couldn't capture deployment URL. Check the output above."
  exit 1
fi

echo
echo "Setting NEXT_PUBLIC_APP_URL to the live URL..."
push_env NEXT_PUBLIC_APP_URL "$DEPLOY_URL"

echo
echo "Triggering a re-deploy so NEXT_PUBLIC_APP_URL takes effect..."
vercel deploy --prod --yes >/dev/null

echo
echo "Deploy complete: $DEPLOY_URL"
echo
echo "Next: trigger the first cron run to populate ingest tables."
echo "      Crons fire automatically on the schedule in vercel.json."
echo
cat <<EOF
for path in seed youtube-channels youtube-videos stocks market-index corporate-actions earnings; do
  echo "→ /api/cron/\$path"
  curl -fsS -H "Authorization: Bearer \$CRON_SECRET" \\
    "$DEPLOY_URL/api/cron/\$path" | jq .
done

curl -fsS -H "Authorization: Bearer \$CRON_SECRET" \\
  "$DEPLOY_URL/api/stats/recompute" | jq .
curl -fsS -H "Authorization: Bearer \$CRON_SECRET" \\
  "$DEPLOY_URL/api/stats/event-study" | jq .
EOF
