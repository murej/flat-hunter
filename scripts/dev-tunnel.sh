#!/usr/bin/env bash
# Start a cloudflared tunnel and set Telegram webhook to the tunnel URL.
# Run in a separate terminal alongside `npm run dev`.
# cloudflared comes from the devDependency (npm install); no global install needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

PORT=${1:-3000}
LOGFILE=$(mktemp)
CF_PID=""

cleanup() {
  echo ""
  echo "👋 Shutting down tunnel..."
  [ -n "$CF_PID" ] && kill "$CF_PID" 2>/dev/null
  rm -f "$LOGFILE"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Start cloudflared in background
cloudflared tunnel --url "http://localhost:$PORT" 2>"$LOGFILE" &
CF_PID=$!

# Wait for the tunnel URL to appear in logs
echo "⏳ Starting cloudflared on port $PORT..."
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGFILE" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ Could not detect tunnel URL after 30s"
  cat "$LOGFILE"
  cleanup
fi

echo "🔗 $TUNNEL_URL"

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
  echo "❌ DNS not resolving. Restart to get a new subdomain."
fi

# Set Telegram webhook (CloudMailin URL printed once below, after Vault sync)
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ "$DNS_OK" = true ]; then
  if TELEGRAM_WEBHOOK_SKIP_INGEST_HINT=1 bash "$SCRIPT_DIR/telegram-webhook.sh" dev "$TUNNEL_URL"; then
    :
  else
    echo "⚠️  Telegram webhook step failed (tunnel still running)."
  fi
elif [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "⚠️  TELEGRAM_BOT_TOKEN not set — skipping webhook"
else
  echo "⚠️  DNS not ready — skipping Telegram webhook; fix DNS or run: npm run telegram:dev -- $TUNNEL_URL"
fi

# Point Supabase pg_cron/pg_net at this tunnel (evaluate + BOE crons; same CRON_SECRET as local Next).
if CRON_APP_BASE_URL="$TUNNEL_URL" bash "$SCRIPT_DIR/sync-evaluate-cron-vault.sh"; then
  echo "✅ Supabase Vault cron URLs + secret updated"
else
  echo "⚠️  Supabase Vault sync failed (CRON_SECRET, SUPABASE_DB_PASSWORD, or supabase login?). Cron may still target a previous URL."
fi
bash "$SCRIPT_DIR/print-cloudmailin-ingest-url.sh" --block "$TUNNEL_URL"

echo ""
echo "Ready. Ctrl+C to stop."

# Wait for cloudflared to exit
wait "$CF_PID"
