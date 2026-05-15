#!/usr/bin/env bash
# Tusk v2 deploy script. Run from the v2/ directory after `vercel link`.
#
# Prereqs (one-time):
#   1. cd v2/
#   2. vercel link          # interactive — pick "Create new project", name "tusk-yt-v2"
#                           # DO NOT link to the existing tips-yt-tusk project.
#
# Then run this script. It will:
#   - prompt for the 3 secret values I couldn't fetch via MCP
#   - push all 11 env vars to Vercel (production scope)
#   - deploy to production
#   - print follow-up curl commands to trigger first cron run

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

# ---- known values (fetched via Supabase MCP) -------------------------------
SUPABASE_URL='https://bfafqccvzboyfjewzvhk.supabase.co'
CRON_SECRET='ee04389406f6e528d347ce814709e5c1c35e7b77ac4976ec5f90f17b39d84e33'
YOUTUBE_API_KEY='AIzaSyDr2qyiUIWnA5bB_HFb4EXUdFILXFI8QS4'
STOCK_SYMBOLS='TIPSMUSIC,SAREGAMA'
MARKET_INDEX_SYMBOLS='NIFTY_MIDCAP_150:^CRSMID,NIFTY_50:^NSEI'
BSE_SCRIP_CODES='TIPSMUSIC:532375,SAREGAMA:532163'
TUSK_ALLOWED_EMAIL_DOMAINS='tuskinvest.com'

# ---- values I couldn't fetch ------------------------------------------------
echo "Need 3 values I couldn't fetch via MCP:"
echo
echo "  SUPABASE_SERVICE_ROLE_KEY  →  https://supabase.com/dashboard/project/bfafqccvzboyfjewzvhk/settings/api-keys"
echo "                                (under 'service_role' secret)"
read -r -s -p "Paste SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY
echo
echo
echo "  CLERK keys  →  https://dashboard.clerk.com  →  new app  →  API Keys"
read -r -s -p "Paste NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_...): " NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
echo
read -r -s -p "Paste CLERK_SECRET_KEY (sk_...): " CLERK_SECRET_KEY
echo
echo

# Resolve deployment URL after first deploy so NEXT_PUBLIC_APP_URL can be set
# in a second pass. For now, leave it blank and patch after the first deploy
# prints the assigned domain.

push_env () {
  local key=$1
  local value=$2
  # Remove first so we don't get "exists" errors; ignore failure if missing.
  echo "$value" | vercel env add "$key" production --force >/dev/null 2>&1 \
    || echo "$value" | vercel env add "$key" production >/dev/null
  echo "  ✓ $key"
}

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
echo "Next: trigger the first cron run to populate market-index + corp-actions + earnings."
echo "       Crons fire automatically on the schedule in vercel.json, but you can warm them:"
echo
cat <<EOF
for path in youtube-channels youtube-videos stocks market-index corporate-actions earnings; do
  echo "→ /api/cron/\$path"
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" \\
    "$DEPLOY_URL/api/cron/\$path" | jq .
done

curl -fsS -H "Authorization: Bearer $CRON_SECRET" \\
  "$DEPLOY_URL/api/stats/recompute" | jq .
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \\
  "$DEPLOY_URL/api/stats/event-study" | jq .
EOF
