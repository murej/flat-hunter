#!/bin/bash
# Push .env variables to Vercel project
# Requires: vercel CLI authenticated

ENV_FILE=".env.local"
[ ! -f "$ENV_FILE" ] && ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env.local or .env file found"
  exit 1
fi

echo "Reading from $ENV_FILE..."

while IFS= read -r line || [ -n "$line" ]; do
  # Skip comments and empty lines
  [[ "$line" =~ ^[[:space:]]*#.* || -z "${line// /}" ]] && continue
  # Split on first = only (preserves = in values like base64 tokens)
  key="${line%%=*}"
  value="${line#*=}"
  key="${key// /}"
  [ -z "$key" ] && continue
  # Strip surrounding quotes
  value="${value#\"}" ; value="${value%\"}"
  value="${value#\'}" ; value="${value%\'}"

  echo "Setting $key..."
  echo "$value" | vercel env add "$key" production --force 2>/dev/null || true
done < "$ENV_FILE"

echo "Done."
