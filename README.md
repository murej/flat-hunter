# Stath

Personal UK property search assistant. Email alerts from Rightmove, Zoopla, OnTheMarket and PrimeLocation flow in via CloudMailin, get parsed and scored by Claude against your preferences, then appear as Telegram scorecards with Save/Skip/Why buttons. Conversational bot handles preferences, comparisons, and viewings.

## How it works

1. You talk to the bot to set your flat hunting preferences
2. Property-site alert emails with new listings are forwarded to the bot
3. Each listing is read and scored against your preferences and what the bot knows about the area, market prices, mortgage rates and transport links
4. The bot sends you properties that fit overall with pros/cons and can explain each score
5. You can like scorecard messages to manage favourite listings

## Setup

1. **Create accounts** (free tiers are enough) and copy your API keys:
   - **[Supabase](https://supabase.com)** — new project → **Project Settings → API:** Project URL, **anon** `public` key, **service_role** key (secret) → **Project Settings → Database:** database password (use **Reset database password** if you do not have it).
   - **[Anthropic](https://platform.anthropic.com)** — API key.
   - **[Telegram](https://www.telegram.org/)** — in Telegram, open **@BotFather**, send **`/newbot`**, follow the prompts, copy the **bot token**. Open **@userinfobot**, send any message, copy your **numeric user ID** (that is `TELEGRAM_CHAT_ID`).
   - **[CloudMailin](https://www.cloudmailin.com)** — create an inbound address and set its target URL (see terminal after step 3)

2. **Configure**
   - **Copy `.env.example` → `.env`** and paste in your API keys

   - **Open any terminal** and run:

   ```bash
   npx supabase login
   npm install
   ```

3. **Deploy**

   ```bash
   npm run deploy
   ```

4. Open **Telegram**, start a chat with **your bot**, and send a message (for example `/start`).

**Optional:** register slash commands:

```bash
npm run set-commands
```

---

## Development

```bash
npm run dev
```

### Stack

- **Runtime**: Next.js (App Router, API routes only) on Vercel Hobby
- **AI**: Vercel AI SDK + `@ai-sdk/anthropic` (Claude Haiku by default)
- **Database**: Supabase Postgres (app uses **service_role**; RLS on `public` tables so anon cannot access app data)
- **Messaging**: Telegram Bot API (raw fetch)
- **Email**: CloudMailin webhook + `langmail` + `postal-mime`
- **Concurrency**: sequential Sonnet experts per listing; optional `EVALUATE_LISTING_GAP_MS` between listings

### Architecture

Two-layer design:

- **Layer 1** (`lib/core/`, `lib/utils/`) — Generic agent infrastructure. Domain-free, reusable LLM runtime. See [`lib/core/README.md`](lib/core/README.md).
- **Layer 2** (everything else) — Stath application. Domain agents, tools, config, schemas. See [`lib/README.md`](lib/README.md).

Layer 1 never imports from Layer 2. Layer 2 imports from Layer 1 freely.
