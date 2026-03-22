#!/bin/bash
# Push .env variables to Vercel project
# Requires: `vercel` devDependency (`npm install`) and CLI auth (`npx vercel login`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

VERCEL="$PROJECT_ROOT/node_modules/.bin/vercel"
[ -x "$VERCEL" ] || VERCEL="vercel"

ENV_FILE="$PROJECT_ROOT/.env.local"
[ ! -f "$ENV_FILE" ] && ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env.local or .env file found in $PROJECT_ROOT"
  exit 1
fi

echo "Reading from $ENV_FILE..."

# Leading/trailing whitespace only (avoids accidental newlines/spaces in pasted secrets on Vercel)
trim_ws() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

NEXT_PUBLIC_PUSHED=false

while IFS= read -r line || [ -n "$line" ]; do
  line="${line//$'\r'/}"
  # Skip comments and empty lines
  [[ "$line" =~ ^[[:space:]]*#.* || -z "${line// /}" ]] && continue
  # Split on first = only (preserves = in values like base64 tokens)
  key="${line%%=*}"
  value="${line#*=}"
  key="$(trim_ws "$key")"
  key="${key// /}"
  [ -z "$key" ] && continue
  # Local-only: DB password for Supabase CLI (never needed on Vercel)
  [[ "$key" == "SUPABASE_DB_PASSWORD" ]] && continue
  # Strip surrounding quotes
  value="${value#\"}" ; value="${value%\"}"
  value="${value#\'}" ; value="${value%\'}"
  value="$(trim_ws "$value")"

  [[ "$key" == NEXT_PUBLIC_* ]] && NEXT_PUBLIC_PUSHED=true

  echo "Setting $key..."
  printf '%s' "$value" | "$VERCEL" env add "$key" production --force
done < "$ENV_FILE"

echo "Done."

if [ "$NEXT_PUBLIC_PUSHED" = true ]; then
  echo ""
  echo "Note: NEXT_PUBLIC_* values are baked at build time. Redeploy production"
  echo "(e.g. npx vercel deploy --prod or trigger a deploy in the Vercel dashboard)"
  echo "so the live site picks up changes to those variables."
fi
