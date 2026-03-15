#!/bin/bash
# Starts cloudflared, registers the tunnel URL as the Telegram webhook, then starts the Next.js dev server.
# Run with: npm run dev:tunnel

set -e

# Load env vars from .env.local
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set in .env.local"
  exit 1
fi

TUNNEL_LOG=$(mktemp)

echo "Starting cloudflared tunnel..."
cloudflared tunnel --url http://localhost:3000 > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for the tunnel to be fully connected (not just URL printed, but connection registered)
TUNNEL_URL=""
CONNECTED=false
for i in $(seq 1 30); do
  sleep 1
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
  if [ -n "$TUNNEL_URL" ] && grep -q "Registered tunnel connection" "$TUNNEL_LOG"; then
    CONNECTED=true
    break
  fi
done

if [ -z "$TUNNEL_URL" ] || [ "$CONNECTED" = false ]; then
  echo "Error: tunnel did not connect in time. Check cloudflared is installed."
  cat "$TUNNEL_LOG"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
fi

# Small extra buffer for the tunnel to be fully routable
sleep 2

echo "Tunnel URL: $TUNNEL_URL"

# Register webhook with Telegram — retry until the tunnel URL resolves
echo "Registering Telegram webhook (retrying until tunnel DNS propagates)..."
WEBHOOK_SET=false
for attempt in $(seq 1 15); do
  sleep 3
  RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"${TUNNEL_URL}/api/telegram\"}")
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    WEBHOOK_SET=true
    break
  fi
  echo "  Attempt $attempt: tunnel not ready yet, retrying..."
done

if [ "$WEBHOOK_SET" = false ]; then
  echo "Error: could not register webhook after 15 attempts. Last response: $RESPONSE"
  kill $TUNNEL_PID 2>/dev/null
  exit 1
fi

echo ""
echo "✓ Bot is now pointing at: ${TUNNEL_URL}/api/telegram"
echo "  To switch back to production when done: npm run use:prod"
echo ""
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down tunnel (PID $TUNNEL_PID)..."
  kill $TUNNEL_PID 2>/dev/null
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT

# Override APP_URL so internal fetch calls (e.g. /api/search) hit the tunnel, not production
export NEXT_PUBLIC_APP_URL="$TUNNEL_URL"

# Start the dev server in the foreground
npm run dev
