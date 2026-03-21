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
- `SUPABASE_DB_PASSWORD` — optional; enables `npx supabase db push --linked` when you run `npm run dev` / `npm run use:prod` (see Deployment). Never commit real secrets. This key is **not** pushed to Vercel by `scripts/push-env-to-vercel.sh` (local CLI only).

### 2. Database

Run `supabase/schema.sql` against your Supabase project to create the 7 tables.

**Supabase CLI (migrations + Vault):** One-time: `npx supabase login`. Put **`SUPABASE_DB_PASSWORD`** and **`NEXT_PUBLIC_SUPABASE_URL`** (e.g. `https://<20-char-ref>.supabase.co`) in `.env.local`. If the project is not linked yet, the script runs `npx supabase link --project-ref <ref>` using the ref parsed from that URL, then **`supabase migration fetch --linked`** (pulls any migration SQL that exists on the remote but not locally—required before `db push` if histories diverged), then **`supabase db push --linked`**. Link state lives under `supabase/.temp/` (gitignored). If the CLI, URL, or password is missing, the migration step is skipped with a warning. Set `SKIP_EVALUATE_CRON_MIGRATION=1` to skip migrations entirely. **`npm run dev`** and **`npm run use:prod`** also sync Vault secrets for the evaluate cron when `CRON_SECRET` and the DB password are set (see Deployment).

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

`npm run dev` starts cloudflared, points Telegram (and prints CloudMailin ingest URL), then runs **`scripts/sync-evaluate-cron-vault.sh`** with the tunnel URL so Supabase Cron calls your local app via `https://…trycloudflare.com/api/cron/evaluate` using the **`CRON_SECRET`** in `.env.local`. Ensure **`CRON_SECRET`** is set locally so those requests authenticate. The trycloudflare hostname changes each run; Vault is updated automatically after the tunnel URL is detected (within about a minute of startup).

## Deployment

```bash
npm run use:prod
```

This pushes `.env.local` to **Vercel Production** via `scripts/push-env-to-vercel.sh` and sets the Telegram webhook. If the Vercel CLI reports an error while setting a variable, the script exits immediately (fix auth, project link, or the variable name, then rerun). After changing any `NEXT_PUBLIC_*` variable, trigger a new production deploy so the client bundle picks up the new values.

Ensure Vercel environment variables are set, including **`CRON_SECRET`** (a long random string). Production rejects unauthenticated cron requests when this variable is set.

**Evaluation cron (Supabase):** Overflow listings that stay in `pending_evaluation` are picked up by **Supabase Cron** (not Vercel Cron), so Hobby’s daily cron limit does not apply.

1. Extensions **pg_cron** and **pg_net** are created by the migration if not already present (see [`supabase/migrations/20260321135818_evaluate_cron.sql`](supabase/migrations/20260321135818_evaluate_cron.sql)). If the Dashboard blocks them, enable there once.
2. **Vault secrets** (`evaluate_cron_url`, `cron_secret`) are updated automatically:
   - **`npm run dev`** — after cloudflared exposes a URL, [`scripts/sync-evaluate-cron-vault.sh`](scripts/sync-evaluate-cron-vault.sh) points Vault at `{tunnel}/api/cron/evaluate` with your local **`CRON_SECRET`**.
   - **`npm run use:prod`** — after migrations, the same script runs in strict mode and sets Vault from **`NEXT_PUBLIC_APP_URL`** + `/api/cron/evaluate` and **`CRON_SECRET`** (which was just pushed to Vercel). This step fails the command if prerequisites are missing so production is not left half-configured.
3. Ad hoc: **`npm run sync-evaluate-cron-vault`** (or set optional **`EVALUATE_CRON_URL`** in `.env.local` to override the default production URL).

The job `flat_hunter_evaluate_cron` runs every 5 minutes and calls the route with `Authorization: Bearer …`. Confirm runs under Dashboard → Integrations → Cron; debug failed HTTP via `net._http_response` if needed.

Manual SQL fallback (SQL Editor), if ever needed:

```sql
select vault.create_secret('https://YOUR_HOST/api/cron/evaluate', 'evaluate_cron_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
```

## Scripts

| Script                                     | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `npm run set-commands`                     | Register Telegram bot commands                 |
| `npm run sync-rate`                        | Sync BoE mortgage rate to Supabase             |
| `npm run sync-evaluate-cron-vault`         | Upsert Supabase Vault secrets for evaluate cron |
| `scripts/dev-tunnel.sh`                    | Start dev tunnel                               |
| `scripts/push-env-to-vercel.sh`            | Push local env to Vercel                       |
| `scripts/use-prod.sh`                      | Switch to production endpoints                 |
| `scripts/apply-evaluate-cron-migration.sh` | `supabase db push --linked` (from npm scripts) |
| `scripts/sync-evaluate-cron-vault.sh`      | Upsert Vault secrets for evaluate cron (from dev / use:prod / `npm run sync-evaluate-cron-vault`) |

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
