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
- `SUPABASE_DB_PASSWORD` — optional; enables `supabase db push --linked` from `npm run dev`, migrate, or deploy (see below). Not pushed to Vercel.

### 2. Database

Run `supabase/schema.sql` against your Supabase project to create the 7 tables.

**Supabase CLI (migrations + Vault):** One-time: `npx supabase login`. Put **`SUPABASE_DB_PASSWORD`** and **`NEXT_PUBLIC_SUPABASE_URL`** (e.g. `https://<20-char-ref>.supabase.co`) in `.env.local`. If the project is not linked yet, the script runs `npx supabase link --project-ref <ref>` using the ref parsed from that URL, then **`supabase migration fetch --linked`** (pulls any migration SQL that exists on the remote but not locally—required before `db push` if histories diverged), then **`supabase db push --linked`**. Link state lives under `supabase/.temp/` (gitignored). If the CLI, URL, or password is missing, the migration step is skipped with a warning. Set `SKIP_EVALUATE_CRON_MIGRATION=1` to skip migrations entirely. With `CRON_SECRET` + DB password set, dev / migrate / deploy also refresh Vault (and prod paths set Telegram) as under **Deployment**.

If you already applied a migration manually (SQL Editor / MCP) and `db push` complains about history, use `npx supabase migration repair <timestamp> --status applied --linked` (see [Supabase migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair)).

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

**`npm run dev`** runs **`migrate:dev`**, then cloudflared. The tunnel sets the webhook and Vault to `{tunnel}/api/cron/evaluate` with **`CRON_SECRET`**. New trycloudflare hostname each run (~1 min until ready).

## Deployment

```bash
npm run deploy
```

**`migrate:prod`** then **`deploy.sh`**: push `.env.local` to Vercel Production and **`vercel deploy --prod`** (fresh build). Env push errors abort immediately. **`DEPLOY_VERCEL_NO_WAIT=1`** skips waiting on the deploy.

**`CRON_SECRET`** must be in `.env.local` and on Vercel for authenticated cron calls.

**Evaluate cron (Supabase pg_cron, not Vercel):** picks up stuck `pending_evaluation` rows; see [`supabase/migrations/20260321135818_evaluate_cron.sql`](supabase/migrations/20260321135818_evaluate_cron.sql) for **pg_cron** / **pg_net**. Enable in Dashboard if blocked.

**Vault** (`evaluate_cron_url`, `cron_secret`): dev tunnel updates after cloudflared URL is known; **`migrate:prod`** / **`deploy`** use **`NEXT_PUBLIC_APP_URL`** (strict; fails if misconfigured). Ad hoc: **`npm run sync-evaluate-cron-vault`** or **`EVALUATE_CRON_URL`**. Webhook only: **`telegram:dev`** / **`telegram:prod`**.

The job `flat_hunter_evaluate_cron` runs every 5 minutes and calls the route with `Authorization: Bearer …`. Confirm runs under Dashboard → Integrations → Cron; debug failed HTTP via `net._http_response` if needed.

Manual SQL fallback (SQL Editor), if ever needed:

```sql
select vault.create_secret('https://YOUR_HOST/api/cron/evaluate', 'evaluate_cron_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
```

## Scripts

| Script | Purpose |
| ------ | ------- |
| `npm run set-commands` | Telegram command list |
| `npm run sync-rate` | BoE mortgage rate → Supabase |
| `npm run sync-evaluate-cron-vault` | Vault secrets for evaluate cron |
| `npm run telegram:dev` / `telegram:prod` | Telegram webhook (dev: optional URL after `--`) |
| `npm run migrate:dev` / `migrate:prod` | Migrations + Vault + webhook (prod strict) |
| `npm run deploy` | `migrate:prod` then env push + `vercel deploy --prod` |
| `scripts/dev-tunnel.sh` | Cloudflared tunnel (used by `npm run dev`) |
| `scripts/telegram-webhook.sh` | Webhook + ingest URL hint |
| `scripts/push-env-to-vercel.sh` / `deploy.sh` | Env → Vercel; deploy wrapper |
| `scripts/apply-evaluate-cron-migration.sh` | Linked `supabase db push` |
| `scripts/sync-evaluate-cron-vault.sh` | Vault upsert (also from dev / migrate / deploy) |

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
