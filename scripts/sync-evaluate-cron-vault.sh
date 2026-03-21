#!/usr/bin/env bash
# Upsert Supabase Vault secrets for pg_cron jobs: evaluate_cron_url, boe_cron_url, cron_secret.
# Requires: npx supabase, supabase login, linked project, SUPABASE_DB_PASSWORD, CRON_SECRET.
# Base URL: CRON_APP_BASE_URL if set in environment (dev-tunnel only), else NEXT_PUBLIC_APP_URL.
# Set SYNC_EVALUATE_CRON_VAULT_STRICT=1 to exit 1 when prerequisites are missing (migrate:prod / deploy).
# Set SKIP_SYNC_EVALUATE_CRON_VAULT=1 to no-op.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

if [ "${SKIP_SYNC_EVALUATE_CRON_VAULT:-}" = "1" ]; then
  echo "Skipping Vault sync (SKIP_SYNC_EVALUATE_CRON_VAULT=1)"
  exit 0
fi

STRICT="${SYNC_EVALUATE_CRON_VAULT_STRICT:-0}"
fail() {
  echo "❌ $*" >&2
  exit 1
}
skip_msg() {
  echo "⚠️  $*"
}

# Preserve tunnel-injected base before load-env (not read from .env in normal flows).
CRON_APP_BASE_URL_FROM_CALLER="${CRON_APP_BASE_URL:-}"

# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

if [ -n "$CRON_APP_BASE_URL_FROM_CALLER" ]; then
  CRON_APP_BASE_URL="$CRON_APP_BASE_URL_FROM_CALLER"
fi

if [ -z "${CRON_SECRET:-}" ]; then
  if [ "$STRICT" = "1" ]; then
    fail "CRON_SECRET is not set (required for Vault sync)"
  fi
  skip_msg "CRON_SECRET not set — skipping Supabase Vault sync"
  exit 0
fi

EVAL_URL=""
BOE_URL=""

if [ -n "${CRON_APP_BASE_URL:-}" ]; then
  BASE="${CRON_APP_BASE_URL%/}"
  EVAL_URL="${BASE}/api/cron/evaluate"
  BOE_URL="${BASE}/api/cron/sync-boe-mortgage-rate"
else
  BASE="${NEXT_PUBLIC_APP_URL:-}"
  BASE="${BASE%/}"
  if [ -z "$BASE" ]; then
    if [ "$STRICT" = "1" ]; then
      fail "NEXT_PUBLIC_APP_URL is not set (required for Vault sync). Dev: run npm run dev so dev-tunnel sets the base URL."
    fi
    skip_msg "NEXT_PUBLIC_APP_URL unset and no CRON_APP_BASE_URL — skipping Vault sync"
    exit 0
  fi
  EVAL_URL="${BASE}/api/cron/evaluate"
  BOE_URL="${BASE}/api/cron/sync-boe-mortgage-rate"
fi

if ! npx supabase --version >/dev/null 2>&1; then
  if [ "$STRICT" = "1" ]; then
    fail "Supabase CLI unavailable (npm install)"
  fi
  skip_msg "Supabase CLI unavailable — skipping Vault sync"
  exit 0
fi

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  if [ "$STRICT" = "1" ]; then
    fail "SUPABASE_DB_PASSWORD not set (required to link project for Vault sync)"
  fi
  skip_msg "SUPABASE_DB_PASSWORD not set — skipping Vault sync"
  exit 0
fi

is_linked() {
  [ -f "$ROOT/supabase/.temp/project-ref" ] || [ -f "$ROOT/.supabase/project-ref" ]
}

project_ref_from_supabase_url() {
  local url="${NEXT_PUBLIC_SUPABASE_URL:-}"
  url="${url%/}"
  if [[ "$url" =~ ^https?://([a-z0-9]{20})\.supabase\.co$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

if ! is_linked; then
  if ! REF="$(project_ref_from_supabase_url)"; then
    if [ "$STRICT" = "1" ]; then
      fail "Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL (expected https://<ref>.supabase.co)"
    fi
    skip_msg "Could not parse NEXT_PUBLIC_SUPABASE_URL — skipping Vault sync"
    exit 0
  fi
  echo "⏳ supabase link (project ref from NEXT_PUBLIC_SUPABASE_URL)…"
  npx supabase link --project-ref "$REF" -p "$SUPABASE_DB_PASSWORD" --yes
fi

sql_escape_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

SQL_FILE="$(mktemp "${TMPDIR:-/tmp}/flat-hunter-vault-sync.XXXXXX.sql")"
cleanup_sql() { rm -f "$SQL_FILE"; }
trap cleanup_sql EXIT

U_ESC="$(sql_escape_literal "$EVAL_URL")"
B_ESC="$(sql_escape_literal "$BOE_URL")"
S_ESC="$(sql_escape_literal "$CRON_SECRET")"

{
  printf '%s\n' \
    'DO $$' \
    'DECLARE' \
    "  v_url text := '$U_ESC';" \
    "  v_boe text := '$B_ESC';" \
    "  v_sec text := '$S_ESC';" \
    '  sid uuid;' \
    'BEGIN' \
    "  SELECT id INTO sid FROM vault.decrypted_secrets WHERE name = 'evaluate_cron_url' LIMIT 1;" \
    '  IF sid IS NULL THEN' \
    "    PERFORM vault.create_secret(v_url, 'evaluate_cron_url', 'flat-hunter evaluate cron URL');" \
    '  ELSE' \
    "    PERFORM vault.update_secret(sid, v_url, 'evaluate_cron_url', 'flat-hunter evaluate cron URL');" \
    '  END IF;' \
    "  SELECT id INTO sid FROM vault.decrypted_secrets WHERE name = 'boe_cron_url' LIMIT 1;" \
    '  IF sid IS NULL THEN' \
    "    PERFORM vault.create_secret(v_boe, 'boe_cron_url', 'flat-hunter BOE mortgage cron URL');" \
    '  ELSE' \
    "    PERFORM vault.update_secret(sid, v_boe, 'boe_cron_url', 'flat-hunter BOE mortgage cron URL');" \
    '  END IF;' \
    "  SELECT id INTO sid FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;" \
    '  IF sid IS NULL THEN' \
    "    PERFORM vault.create_secret(v_sec, 'cron_secret', 'flat-hunter cron bearer');" \
    '  ELSE' \
    "    PERFORM vault.update_secret(sid, v_sec, 'cron_secret', 'flat-hunter cron bearer');" \
    '  END IF;' \
    'END' \
    '$$;'
} >"$SQL_FILE"

echo "⏳ supabase db query --linked (Vault: evaluate_cron_url, boe_cron_url, cron_secret)…"
npx supabase db query --linked -f "$SQL_FILE" --yes --agent=no
echo "✅ Supabase Vault updated for evaluate + BOE mortgage crons."
