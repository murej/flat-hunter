#!/bin/bash
# Set Telegram webhook to production URL
# Usage: ./scripts/use-prod.sh <vercel-url>

source "$(dirname "$0")/load-env.sh"

URL="${1:-https://your-app.vercel.app}"
BOT_TOKEN="$TELEGRAM_BOT_TOKEN"

if [ -z "$BOT_TOKEN" ]; then
  echo "TELEGRAM_BOT_TOKEN not set"
  exit 1
fi

# Push env first
bash scripts/push-env-to-vercel.sh

echo "Setting webhook to $URL/api/telegram..."
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$URL/api/telegram\"}" | python3 -m json.tool 2>/dev/null || true
