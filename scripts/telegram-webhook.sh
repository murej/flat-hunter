#!/usr/bin/env bash
# Point Telegram at this app's /api/telegram and print CloudMailin ingest URL.
# Usage: telegram-webhook.sh dev [BASE_URL]  — BASE_URL defaults to NEXT_PUBLIC_APP_URL
#        telegram-webhook.sh prod           — requires NEXT_PUBLIC_APP_URL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

MODE="${1:-}"
case "$MODE" in
  dev)
    shift
    URL="${1:-${NEXT_PUBLIC_APP_URL:-}}"
    ;;
  prod)
    URL="${NEXT_PUBLIC_APP_URL:-}"
    ;;
  *)
    echo "Usage: $0 dev [BASE_URL] | $0 prod" >&2
    exit 1
    ;;
esac

URL="${URL%/}"

if [ -z "$URL" ]; then
  echo "❌ No app base URL. For dev pass a URL or set NEXT_PUBLIC_APP_URL. For prod set NEXT_PUBLIC_APP_URL." >&2
  exit 1
fi

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$BOT_TOKEN" ]; then
  echo "❌ TELEGRAM_BOT_TOKEN not set" >&2
  exit 1
fi

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

if [ -z "${TELEGRAM_WEBHOOK_SKIP_INGEST_HINT:-}" ]; then
  bash "$SCRIPT_DIR/print-cloudmailin-ingest-url.sh" "$URL"
fi
