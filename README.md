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
- `SUPABASE_DB_PASSWORD` — Postgres password for your Supabase project (see **Database** below). Needed for `npm run migrate:dev` / `dev` / `deploy`. Not pushed to Vercel.

### 2. Database

Do these **in order**. If a step fails, fix that step before continuing.

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is enough).
2. **Copy keys into `.env.local`** (same file as in step 1 of **Environment variables**):
   - **Project Settings → API:** `NEXT_PUBLIC_SUPABASE_URL` = *Project URL*, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = *anon* `public`, `SUPABASE_SERVICE_ROLE_KEY` = *service_role* (keep this secret).
   - **Project Settings → Database:** `SUPABASE_DB_PASSWORD` = the **Database password** for this project (the one you chose at project creation). If you do not know it, use **Reset database password** on that page, then paste the new value into `.env.local`.
3. **Install packages** (once): `npm install`
4. **Log in to Supabase from your machine** (once): `npx supabase login` (a browser window opens; finish sign-in).
5. **Create and update all tables:** `npm run migrate:dev`  
   Wait until it finishes. First run can take a minute (it links the project, syncs migration files, then applies them).

**Success check:** the command ends without errors and you see tables under **Table Editor** in the Supabase dashboard.

**If it skips the database or only prints warnings:** `SUPABASE_DB_PASSWORD` or `NEXT_PUBLIC_SUPABASE_URL` is usually wrong or empty — fix `.env.local` and run step 5 again.

**Optional:** set `SKIP_EVALUATE_CRON_MIGRATION=1` in `.env.local` to turn off this step (not recommended for a new setup).

**If you edited SQL by hand** and later see migration history errors: [Supabase migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).

`supabase/schema.sql` in the repo is a reference snapshot; the real source of truth is `supabase/migrations/` applied via step 5.

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

**Supabase crons (pg_cron + pg_net, not Vercel):**

- **`flat_hunter_evaluate_cron`** — every 5 minutes; picks up stuck `pending_evaluation` rows via [`20260321135818_evaluate_cron.sql`](supabase/migrations/20260321135818_evaluate_cron.sql).
- **`flat_hunter_boe_mortgage_cron`** — `0 6 1 * *` (06:00 UTC on the 1st of each month); calls **`GET /api/cron/sync-boe-mortgage-rate`**, which upserts **`MORTGAGE_RATE`** from env into **`agent_context`** (same as **`npm run sync-rate`**). Defined in [`20260321140000_boe_cron_vault_and_unschedule_legacy.sql`](supabase/migrations/20260321140000_boe_cron_vault_and_unschedule_legacy.sql) (replaces the old Edge Function target).

Enable **pg_cron** / **pg_net** in Dashboard if a migration is blocked.

**Vault** (`evaluate_cron_url`, **`boe_cron_url`**, `cron_secret`): **`NEXT_PUBLIC_APP_URL`** drives both cron targets in prod (**`migrate:prod`** / **`deploy`** / **`npm run sync-evaluate-cron-vault`**). **`npm run dev`** passes the cloudflared origin into the sync script only (not an `.env` variable). Ad hoc: **`npm run sync-evaluate-cron-vault`**. Webhook only: **`telegram:dev`** / **`telegram:prod`**.

Confirm runs under Dashboard → Integrations → Cron; debug failed HTTP via **`net._http_response`** if needed.

Manual SQL fallback (SQL Editor), if ever needed:

```sql
select vault.create_secret('https://YOUR_HOST/api/cron/evaluate', 'evaluate_cron_url');
select vault.create_secret('https://YOUR_HOST/api/cron/sync-boe-mortgage-rate', 'boe_cron_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
```

## Scripts

| Script                                     | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `npm run set-commands`                     | Register Telegram bot commands                 |
| `npm run sync-rate`                        | Sync mortgage rate to `agent_context` (same logic as monthly cron route) |
| `npm run sync-evaluate-cron-vault`         | Upsert Supabase Vault secrets for evaluate + BOE crons |
| `scripts/dev-tunnel.sh`                    | Start dev tunnel                               |
| `scripts/push-env-to-vercel.sh`            | Push local env to Vercel                       |
| `scripts/use-prod.sh`                      | Switch to production endpoints                 |
| `scripts/apply-evaluate-cron-migration.sh` | `supabase db push --linked` (from npm scripts) |
| `scripts/sync-evaluate-cron-vault.sh`      | Upsert Vault secrets (from dev tunnel / `migrate:*` / `npm run sync-evaluate-cron-vault`) |

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
