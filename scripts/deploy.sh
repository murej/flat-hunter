#!/usr/bin/env bash
# Push .env.local to Vercel Production and run a new production deploy (not redeploy).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

VERCEL="$PROJECT_ROOT/node_modules/.bin/vercel"
[ -x "$VERCEL" ] || VERCEL="vercel"

bash "$SCRIPT_DIR/push-env-to-vercel.sh"

# DEPLOY_VERCEL_NO_WAIT=1 to exit before the deployment finishes
DEPLOY_ARGS=(deploy --prod --non-interactive)
[ "${DEPLOY_VERCEL_NO_WAIT:-}" = "1" ] && DEPLOY_ARGS+=(--no-wait)

echo "⏳ Vercel production deploy..."
"$VERCEL" "${DEPLOY_ARGS[@]}"
echo "✅ Vercel deploy finished (or queued with --no-wait)."
