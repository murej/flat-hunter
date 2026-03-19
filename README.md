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

1. **Install:** `npm install`
2. **Create `.env.local`** in the project root with following variables:

| Variable                        | What it does                                                |
| ------------------------------- | ----------------------------------------------------------- |
| `ANTHROPIC_API_KEY`             | API key from Anthropic. Powers the AI.                      |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL.                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key.                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service role key — keep secret.                    |
| `TELEGRAM_BOT_TOKEN`            | Token from @BotFather.                                      |
| `TELEGRAM_CHAT_ID`              | Your chat ID (get from @userinfobot).                       |
| `CLOUDMAILIN_SECRET`            | Email password (make it up, no special characters).         |
| `MORTGAGE_RATE`                 | Annual rate override. Defaults to 4.5, autoupdates monthly. |
| `TFL_APP_KEY`                   | Optional. TfL credentials for commute.                      |
| `NEXT_PUBLIC_APP_URL`           | Deployed app URL                                            |

3. **Create a database**
   - Create [Supabase](https://supabase.com) project\*\*
   - Open SQL Editor, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   - **Mortgage rates sync (optional):** Deploy a Supabase Edge Function (see [`scripts/sync-boe-mortgage-rate.ts`](scripts/sync-boe-mortgage-rate.ts)), then configure a monthly cron job to run it.

   TIP: You can use Supabase MCP to do this easily

4. **Email ingestion**

- Create a [Cloudmailin](https://www.cloudmailin.com) email account
- Set up email alerts from property websites to your new email address
- Set the **Target** of the email address to (see below):

```HTML
https://cloudmailin:<CLOUDMAILIN_SECRET>@<your-tunnel-or-deoployed-url>/api/ingest
```

5. **Deploy**

- Deploy to [Vercel](https://vercel.com)
- Copy environment variables to Vercel

```
npm run env:push
```

- Point Telegram bot to deployed Vercel URL

```
npm run use:prod
```

---

[Architecture and development docs](docs/README.md)
