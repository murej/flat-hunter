#!/usr/bin/env bash
# Supabase migrations + strict Vault for evaluate cron + Telegram to production URL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$SCRIPT_DIR/apply-evaluate-cron-migration.sh"
SYNC_EVALUATE_CRON_VAULT_STRICT=1 bash "$SCRIPT_DIR/sync-evaluate-cron-vault.sh"
bash "$SCRIPT_DIR/telegram-webhook.sh" prod
