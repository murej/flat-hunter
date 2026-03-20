#!/bin/bash
# Set Telegram webhook to production URL
# Usage: ./scripts/use-prod.sh <vercel-url>

URL="${1:-https://your-app.vercel.app}"
BOT_TOKEN="$TELEGRAM_BOT_TOKEN"

if [ -z "$BOT_TOKEN" ]; then
  echo "TELEGRAM_BOT_TOKEN not set"
  exit 1
fi

# Push env first
bash scripts/push-env-to-vercel.sh

echo "Setting webhook to $URL/api/telegram..."
curl -s "https://api.telegram.org/bot$BOT_TOKEN/setWebhook?url=$URL/api/telegram" | jq .
