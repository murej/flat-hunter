#!/bin/bash
# Set Telegram webhook to production URL
# Usage: ./scripts/use-prod.sh [vercel-url]
# If omitted, uses NEXT_PUBLIC_APP_URL from .env.local (via load-env.sh).

set -euo pipefail

source "$(dirname "$0")/load-env.sh"

URL="${1:-${NEXT_PUBLIC_APP_URL:-}}"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

if [ -z "$URL" ]; then
  echo "❌ No app URL. Pass it as the first argument or set NEXT_PUBLIC_APP_URL in .env.local."
  exit 1
fi

# Normalise: strip trailing slash
URL="${URL%/}"

if [ -z "$BOT_TOKEN" ]; then
  echo "❌ TELEGRAM_BOT_TOKEN not set"
  exit 1
fi

echo "⏳ Pushing env vars to Vercel..."
bash "$(dirname "$0")/push-env-to-vercel.sh"

echo "🔗 $URL"

APP_HOST="${URL#https://}"
APP_HOST="${APP_HOST#http://}"

echo "⏳ Setting Telegram webhook to $URL/api/telegram..."
WEBHOOK_OK=false
for attempt in $(seq 1 3); do
  RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"${URL}/api/telegram\", \"allowed_updates\": [\"message\", \"callback_query\", \"message_reaction\"]}")
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "✅ Telegram webhook set"
    WEBHOOK_OK=true
    break
  fi
  [ "$attempt" -lt 3 ] && sleep 3 || echo "❌ setWebhook failed: $RESPONSE"
done

if [ "$WEBHOOK_OK" = false ]; then
  exit 1
fi

# CloudMailin ingest URL (same pattern as dev-tunnel.sh)
if [ -n "${CLOUDMAILIN_SECRET:-}" ]; then
  echo "📬 https://cloudmailin:${CLOUDMAILIN_SECRET}@${APP_HOST}/api/ingest (set in CloudMailin as target URL)"
else
  echo "📬 ${URL}/api/ingest"
fi

echo ""
echo "Ready. Production webhook points at ${URL}/api/telegram."
