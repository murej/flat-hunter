#!/bin/bash
# Push .env variables to Vercel project
# Requires: vercel CLI authenticated

if [ ! -f .env ]; then
  echo "No .env file found"
  exit 1
fi

while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ "$key" =~ ^#.*$ ]] && continue
  [[ -z "$key" ]] && continue

  echo "Setting $key..."
  echo "$value" | vercel env add "$key" production --force 2>/dev/null || true
done < .env

echo "Done."
