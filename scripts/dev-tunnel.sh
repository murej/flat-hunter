#!/bin/bash
# Start a dev tunnel for local Telegram webhook testing
# Requires: npx localtunnel or ngrok

PORT=${1:-3000}

echo "Starting tunnel on port $PORT..."
npx localtunnel --port "$PORT" --subdomain stath-dev
