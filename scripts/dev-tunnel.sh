#!/bin/bash
# Start a cloudflared tunnel and set Telegram webhook to the tunnel URL.
# Run in a separate terminal alongside `npm run dev`.
# Requires: cloudflared (brew install cloudflared)

set -euo pipefail

source "$(dirname "$0")/load-env.sh"

PORT=${1:-3000}
LOGFILE=$(mktemp)
CF_PID=""

cleanup() {
  echo ""
  echo "Shutting down tunnel..."
  [ -n "$CF_PID" ] && kill "$CF_PID" 2>/dev/null
  rm -f "$LOGFILE"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start cloudflared in background
cloudflared tunnel --url "http://localhost:$PORT" 2>"$LOGFILE" &
CF_PID=$!

# Wait for the tunnel URL to appear in logs
echo "Starting cloudflared tunnel on port $PORT..."
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGFILE" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: Could not detect tunnel URL after 30s"
  cat "$LOGFILE"
  cleanup
fi

echo ""
echo "Tunnel URL: $TUNNEL_URL"

echo ""

# Set Telegram webhook (retry up to 5 times — DNS may not have propagated yet)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  WEBHOOK_URL="$TUNNEL_URL/api/telegram"
  echo "Setting Telegram webhook to $WEBHOOK_URL..."
  for attempt in $(seq 1 5); do
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
      -H "Content-Type: application/json" \
      -d "{\"url\": \"${WEBHOOK_URL}\"}")
    if echo "$RESPONSE" | grep -q '"ok":true'; then
      echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
      break
    fi
    if [ "$attempt" -eq 5 ]; then
      echo "Failed after 5 attempts:"
      echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    else
      echo "Attempt $attempt failed, retrying in 3s..."
      sleep 3
    fi
  done
  echo ""
else
  echo "TELEGRAM_BOT_TOKEN not set — skipping webhook setup"
fi

if [ -n "${CLOUDMAILIN_SECRET:-}" ]; then
  echo "Ingest URL: https://cloudmailin:${CLOUDMAILIN_SECRET}@${TUNNEL_URL#https://}/api/ingest"
else
  echo "Ingest URL: $TUNNEL_URL/api/ingest"
fi
echo "(Set this in CloudMailin dashboard)"
echo ""
echo "Tunnel running. Press Ctrl+C to stop."

# Wait for cloudflared to exit
wait "$CF_PID"
