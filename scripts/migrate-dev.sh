#!/usr/bin/env bash
# Supabase migrations + optional Vault + Telegram when NEXT_PUBLIC_APP_URL is set.
# If URL is empty, dev-tunnel will set Vault + Telegram using the tunnel URL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

bash "$SCRIPT_DIR/apply-evaluate-cron-migration.sh"

BASE="${NEXT_PUBLIC_APP_URL:-}"
BASE="${BASE%/}"

if [ -n "$BASE" ]; then
  bash "$SCRIPT_DIR/sync-evaluate-cron-vault.sh"
  bash "$SCRIPT_DIR/telegram-webhook.sh" dev
else
  echo "ℹ️  NEXT_PUBLIC_APP_URL unset — skipping Vault + Telegram here; dev-tunnel will set them when the tunnel URL is ready."
fi
