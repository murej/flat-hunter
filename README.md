# Stath

Personal UK property search assistant. Email alerts from Rightmove, Zoopla, OnTheMarket and PrimeLocation flow in via CloudMailin, get parsed and scored by Claude against your preferences, then appear as Telegram scorecards with Save/Skip/Why buttons. Conversational bot handles preferences, comparisons, and viewings.

## Stack

- **Runtime**: Next.js (App Router, API routes only) on Vercel Hobby
- **AI**: Vercel AI SDK + `@ai-sdk/anthropic` (Claude Haiku by default)
- **Database**: Supabase Postgres (service-role, no RLS)
- **Messaging**: Telegram Bot API (raw fetch)
- **Email**: CloudMailin webhook + `langmail` + `postal-mime`
- **Concurrency**: `p-limit` for LLM rate-limit management

## Architecture

Two-layer design:

- **Layer 1** (`lib/core/`, `lib/utils/`) — Generic agent infrastructure. Domain-free, reusable LLM runtime. See [`lib/core/README.md`](lib/core/README.md).
- **Layer 2** (everything else) — Stath application. Domain agents, tools, config, schemas. See [`lib/README.md`](lib/README.md).

Layer 1 never imports from Layer 2. Layer 2 imports from Layer 1 freely.

## Setup

### 1. Environment variables

Copy `.env.example` and fill in values:

```bash
cp .env.example .env.local
```

Required:
- `ANTHROPIC_API_KEY` — Claude API key
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase project credentials
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram bot

Optional:
- `CLOUDMAILIN_SECRET` — HTTP Basic auth for ingest webhook
- `TFL_APP_ID`, `TFL_APP_KEY` — TfL Journey Planner (commute scoring)
- `MORTGAGE_RATE` — Override mortgage rate (default 4.5%)
- Model overrides (`PROPERTY_EXPERT_MODEL`, `AREA_EXPERT_MODEL`, etc.) — all default to `claude-haiku-4-5`
- Cost control flags (`PROPERTY_EXPERT_WEB_SEARCH`, `AREA_EXPERT_WEB_SEARCH`, etc.)

### 2. Database

Run `supabase/schema.sql` against your Supabase project to create the 7 tables.

### 3. Telegram bot

Register commands:

```bash
npm run set-commands
```

Set the webhook URL to `https://<your-domain>/api/telegram`.

### 4. CloudMailin

Point your CloudMailin address to `https://<your-domain>/api/ingest` (raw format or JSON).

## Development

```bash
npm run dev
```

Start a tunnel (e.g. cloudflared) and point CloudMailin + Telegram webhook to the tunnel URL.

## Deployment

```bash
npm run use:prod
```

Ensure Vercel environment variables are set. The cron job (`/api/cron/evaluate`, every 5 minutes) picks up any listings that didn't finish evaluating within the webhook timeout.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run set-commands` | Register Telegram bot commands |
| `npm run sync-rate` | Sync BoE mortgage rate to Supabase |
| `scripts/dev-tunnel.sh` | Start dev tunnel |
| `scripts/push-env-to-vercel.sh` | Push local env to Vercel |
| `scripts/use-prod.sh` | Switch to production endpoints |

## How it works

1. Property alert email arrives at CloudMailin
2. `/api/ingest` parses email, deduplicates listings, stores them as `pending_evaluation`
3. Evaluation pipeline runs (background via `waitUntil`):
   - Property Expert scores price/size/fit
   - Area Expert scores neighbourhood (crime, IMD, area profiles)
   - Commute calculator scores travel time (TfL/Nominatim)
   - Finance calculator computes mortgage, SDLT, monthly costs
4. Scorecard sent to Telegram with Save/Skip/Why buttons
5. Overflow listings caught by cron within 5 minutes
6. Chat with the bot to update preferences, compare properties, request explanations
