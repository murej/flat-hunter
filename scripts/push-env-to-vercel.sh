#!/usr/bin/env bash
# Push .env.local to Vercel production only (no development/preview)
# Run from project root: ./scripts/push-env-to-vercel.sh

set -e
cd "$(dirname "$0")/.."

[[ -f .env.local ]] || { echo ".env.local not found"; exit 1; }

trim() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key=$(trim "${line%%=*}")
  value=$(trim "${line#*=}")
  value="${value#\"}"
  value="${value%\"}"
  value=$(trim "$value")
  [[ -z "$key" ]] && continue
  [[ -z "$value" ]] && { echo "Skipped (empty): $key"; continue; }

  # production only; --force overwrites existing (no duplicates)
  printf '%s' "$value" | vercel env add "$key" production --force --yes
  echo "Set: $key"
done < .env.local

echo "Done. All env vars pushed to Vercel production."
