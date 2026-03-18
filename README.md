# Flat Hunter

A Telegram bot that helps you find and evaluate properties. It parses property alert emails, scores listings based on your preferences.

---

## How to use

1. **Open your bot** on Telegram and start a chat.
2. **Set your preferences** — the bot will ask about areas, budget, bedrooms, must-haves, deal-breakers, and commute. Answer in plain language.
3. **Connect your email alerts** — forward Rightmove/Zoopla alerts to an email address that posts to the app. New listings are parsed, scored, and sent to you.
4. **Act on listings** — each scorecard has buttons:
   - **Save** — add to your shortlist
   - **Skip** — dismiss
   - **Why?** — get a plain-English explanation of the scores
5. **Ask anything** — compare properties, update preferences, or ask questions about specific listings.

---

## Develop

### What you need

- **Node.js** (v18+) and **npm**
- **Accounts** (free tiers): [Supabase](https://supabase.com), [Anthropic](https://console.anthropic.com), [Telegram](https://t.me/BotFather), [Cloudmailin](https://www.cloudmailin.com) (optional if you only want to test without listings)

### Setup

1. **Install:** `npm install`
2. **Create `.env.local`** in the project root:

| Variable                        | What it does                                                 |
| ------------------------------- | ------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`             | API key from Anthropic. Powers the AI.                       |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL.                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key.                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service role key — keep secret.                     |
| `TELEGRAM_BOT_TOKEN`            | Token from @BotFather.                                       |
| `TELEGRAM_CHAT_ID`              | Your chat ID (get from @userinfobot).                        |
| `CLOUDMAILIN_SECRET`            | Webhook password. Set in production; optional for local dev. |
| `MORTGAGE_RATE`                 | Annual rate override. Defaults to 4.5, autoupdates monthly.  |
| `TFL_APP_ID` / `TFL_APP_KEY`    | Optional. TfL credentials for commute.                       |
| `NEXT_PUBLIC_APP_URL`           | App URL. Set by Vercel or dev tunnel.                        |

3. **Database:**
   - Create a [Supabase](https://supabase.com) project
   - Open SQL Editor, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
   - **Mortgage rates sync (optional):** Deploy a Supabase Edge Function (see [`scripts/sync-boe-mortgage-rate.ts`](scripts/sync-boe-mortgage-rate.ts)), then configure a monthly cron job to run it.

   TIP: You can use Supabase MCP to do this easily

### Local development

- `npm run dev:tunnel` — full bot (needs [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/))

### Deploy

1. Deploy to [Vercel](https://vercel.com)
2. `npm run env:push` to set up environment variables
3. `npm run use:prod` to point Telegram bot to production

### Email ingestion

Point your Cloudmailin target to

```
https://cloudmailin:<CLOUDMAILIN_SECRET>@<your-tunnel-or-deoployed-url>/api/ingest
```
