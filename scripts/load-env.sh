#!/bin/bash
# Load environment variables from .env.local (preferred) or .env (fallback).
# Sourced by other scripts — not run directly.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="$PROJECT_ROOT/.env.local"
[ ! -f "$ENV_FILE" ] && ENV_FILE="$PROJECT_ROOT/.env"
[ ! -f "$ENV_FILE" ] && return 0

while IFS= read -r line || [ -n "$line" ]; do
  line="${line//$'\r'/}"
  [[ "$line" =~ ^[[:space:]]*#.* || -z "${line// /}" ]] && continue
  # Split on first = only (preserves = in values like base64 tokens)
  key="${line%%=*}"
  value="${line#*=}"
  key="${key// /}"
  [ -z "$key" ] && continue
  # Strip leading/trailing whitespace and surrounding quotes from value
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#\"}" ; value="${value%\"}"
  value="${value#\'}" ; value="${value%\'}"
  export "$key"="$value"
done < "$ENV_FILE"
