#!/bin/bash
# Re-points the Telegram webhook back to the Vercel production URL.
# Run with: npm run use:prod

if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

PROD_URL="${NEXT_PUBLIC_APP_URL:-https://flat-hunter-psi.vercel.app}"

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set in .env.local"
  exit 1
fi

echo "Pointing Telegram webhook at: ${PROD_URL}/api/telegram"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${PROD_URL}/api/telegram\"}"

echo ""
echo "Done. Bot is now live on Vercel."
