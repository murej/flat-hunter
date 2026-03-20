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

echo "Tunnel: $TUNNEL_URL"

# Wait for public DNS resolution
TUNNEL_HOST="${TUNNEL_URL#https://}"
DNS_OK=false
for attempt in $(seq 1 15); do
  if dig +short @8.8.8.8 "$TUNNEL_HOST" 2>/dev/null | grep -q .; then
    DNS_OK=true
    break
  fi
  sleep 2
done

if [ "$DNS_OK" = false ]; then
  echo "DNS not resolving. Restart to get a new subdomain."
fi

# Set Telegram webhook
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ "$DNS_OK" = true ]; then
  for attempt in $(seq 1 3); do
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
      -H "Content-Type: application/json" \
      -d "{\"url\": \"${TUNNEL_URL}/api/telegram\"}")
    if echo "$RESPONSE" | grep -q '"ok":true'; then
      echo "Telegram webhook set."
      break
    fi
    [ "$attempt" -lt 3 ] && sleep 3 || echo "setWebhook failed: $RESPONSE"
  done
elif [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN not set — skipping webhook."
fi

# CloudMailin ingest URL
if [ -n "${CLOUDMAILIN_SECRET:-}" ]; then
  echo "Ingest:  https://cloudmailin:${CLOUDMAILIN_SECRET}@${TUNNEL_HOST}/api/ingest (set in CloudMailin dashboard)"
else
  echo "Ingest:  $TUNNEL_URL/api/ingest"
fi

echo "Ready. Ctrl+C to stop."

# Wait for cloudflared to exit
wait "$CF_PID"
