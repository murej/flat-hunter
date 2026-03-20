#!/bin/bash
# Start a cloudflared tunnel and set Telegram webhook to the tunnel URL.
# Run in a separate terminal alongside `npm run dev`.
# Requires: cloudflared (brew install cloudflared)

set -euo pipefail

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

# Set Telegram webhook
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  WEBHOOK_URL="$TUNNEL_URL/api/telegram"
  echo "Setting Telegram webhook to $WEBHOOK_URL..."
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$WEBHOOK_URL" | python3 -m json.tool 2>/dev/null || true
  echo ""
else
  echo "TELEGRAM_BOT_TOKEN not set — skipping webhook setup"
fi

echo "Ingest URL: $TUNNEL_URL/api/ingest"
echo "(Set this in CloudMailin dashboard if needed)"
echo ""
echo "Tunnel running. Press Ctrl+C to stop."

# Wait for cloudflared to exit
wait "$CF_PID"
