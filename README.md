# Flat Hunter

A Telegram bot that helps you find and evaluate properties. It parses property alert emails, scores listings based on your preferences.

---

## How to use

1. **Open your bot** on Telegram and start a chat.
2. **Set your preferences** — the bot will ask about areas, budget, bedrooms, must-haves, deal-breakers, and commute. Answer in plain language.
3. **Connect your email alerts** — forward Rightmove/Zoopla alerts to an email address that posts to the app. New listings are parsed, scored, and sent to you.
4. **Get notified** when a listing matches your preferences at least relatively well
5. **Act on listings**
   - **Save** — add to your shortlist
   - **Skip** — dismiss
   - **Why?** — get a plain-English explanation of the scores
6. **Ask anything** — compare properties, update preferences, or ask questions about specific listings.

---

## What you need

- **Node.js** (v18+) and **npm**
- **Accounts** (free tiers): [Supabase](https://supabase.com), [Anthropic](https://console.anthropic.com), [Telegram](https://t.me/BotFather), [Cloudmailin](https://www.cloudmailin.com)

## Setup

1. **Install:**

```
npm install
```

2. **Create `.env.local`** in the project root (copy `.env.example`) and set required environment variables (see next steps)

3. **Create a database**
   - Create [Supabase](https://supabase.com) project\*\*
   - Get your API keys and copy them to enviro

   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

   - Open SQL Editor, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   - **Mortgage rates sync (optional):** Deploy a Supabase Edge Function (see [`scripts/sync-boe-mortgage-rate.ts`](scripts/sync-boe-mortgage-rate.ts)), then configure a monthly cron job to run it.

   TIP: You can use Supabase MCP to do this easily

4. **Set up Telegram bot**
   - Create a new bot by messaging @BotFather
   - Copy the API token and chat ID to environment variables

   ```
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_CHAT_ID=
   ```

5. **Set up email ingestion**

- Create a [Cloudmailin](https://www.cloudmailin.com) email account
- Set up email alerts from property websites to your new email address
- Set the **Target** of the email address to (see below):

```HTML
https://cloudmailin:<CLOUDMAILIN_SECRET>@<your-tunnel-or-deoployed-url>/api/ingest
```

6. **Deploy**

- Deploy to [Vercel](https://vercel.com) and copy the public url
- Point `NEXT_PUBLIC_APP_URL` environment variable to deployed URL
- Configure Vercel project and the Telegram bot

```
npm run use:prod
```

---

[Architecture and development docs](docs/README.md)
