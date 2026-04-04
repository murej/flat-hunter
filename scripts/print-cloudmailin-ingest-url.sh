#!/usr/bin/env bash
# Print CloudMailin ingest URL for an app base URL (e.g. https://xxx.trycloudflare.com).
# Usage: print-cloudmailin-ingest-url.sh [--block] <BASE_URL>
#   --block   Ruled block (dev-tunnel); default is one line with 📬

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$SCRIPT_DIR/load-env.sh"

BLOCK=false
if [ "${1:-}" = "--block" ]; then
  BLOCK=true
  shift
fi

URL="${1:-}"
URL="${URL%/}"
if [ -z "$URL" ]; then
  echo "Usage: $0 [--block] <BASE_URL>" >&2
  exit 1
fi

APP_HOST="${URL#https://}"
APP_HOST="${APP_HOST#http://}"

if [ "$BLOCK" = true ]; then
  echo ""
  if [ -n "${CLOUDMAILIN_SECRET:-}" ]; then
    echo "📬 Set CloudMailin target URL to:"
    echo "———————————————————————————————————————————————————————————————————————————————————————————————————————————"
    echo "https://cloudmailin:${CLOUDMAILIN_SECRET}@${APP_HOST}/api/ingest"

  else
  echo "———————————————————————————————————————————————————————————————————————————————————————————————————————————"
    echo "  📬  $URL/api/ingest"
  fi
  echo "———————————————————————————————————————————————————————————————————————————————————————————————————————————"
fi
