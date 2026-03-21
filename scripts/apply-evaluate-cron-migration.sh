#!/usr/bin/env bash
# Apply pending supabase/migrations to the linked remote project (includes evaluate cron).
# Requires: npx supabase, NEXT_PUBLIC_SUPABASE_URL (for ref), SUPABASE_DB_PASSWORD, supabase login.
# If not linked yet, runs: npx supabase link --project-ref <ref from URL> -p ...
# Set SKIP_EVALUATE_CRON_MIGRATION=1 to skip.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

if [ "${SKIP_EVALUATE_CRON_MIGRATION:-}" = "1" ]; then
  echo "Skipping Supabase db push (SKIP_EVALUATE_CRON_MIGRATION=1)"
  exit 0
fi

if [ -z "$(find "$ROOT/supabase/migrations" -maxdepth 1 -name '*.sql' -print -quit 2>/dev/null)" ]; then
  echo "⚠️  No SQL files in supabase/migrations/ (skipping db push)"
  exit 0
fi

if ! npx supabase --version >/dev/null 2>&1; then
  echo "⚠️  Supabase CLI unavailable (npm install). Skipping db push."
  exit 0
fi

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "⚠️  SUPABASE_DB_PASSWORD not set. Skipping supabase link / db push."
  exit 0
fi

is_linked() {
  [ -f "$ROOT/supabase/.temp/project-ref" ] || [ -f "$ROOT/.supabase/project-ref" ]
}

# Extract 20-char project ref from https://<ref>.supabase.co (hosted projects only).
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
    echo "⚠️  Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL (expected https://<20-char-ref>.supabase.co). Run: npx supabase link --project-ref <ref>"
    exit 0
  fi
  echo "⏳ supabase link (project ref from NEXT_PUBLIC_SUPABASE_URL)…"
  npx supabase link --project-ref "$REF" -p "$SUPABASE_DB_PASSWORD" --yes
fi

echo "⏳ supabase migration fetch --linked (sync migration files with remote history)…"
printf 'y\n' | npx supabase migration fetch --linked --yes

echo "⏳ supabase db push --linked (pending migrations)…"
npx supabase db push --linked -p "$SUPABASE_DB_PASSWORD"
echo "✅ Supabase migrations applied (or already up to date)."
