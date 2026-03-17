# Flat Hunter

A Telegram bot that helps you find and evaluate properties. It parses Rightmove/Zoopla alert emails, scores listings by fit, area, and commute.

---

## How to use

1. **Open your bot** on Telegram and start a chat.
2. **Set your preferences** — the bot will ask about areas, budget, bedrooms, must-haves, deal-breakers, and commute. Answer in plain language.
3. **Connect your email alerts** — forward Rightmove/Zoopla alerts to a Cloudmailin address that posts to the app. New listings are parsed, scored, and sent to you.
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

| Variable | What it does |
|----------|--------------|
| `ANTHROPIC_API_KEY` | API key from Anthropic. Powers the AI. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — keep secret. |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather. |
| `TELEGRAM_CHAT_ID` | Your chat ID (get from @userinfobot). |
| `CLOUDMAILIN_SECRET` | Webhook password. Set in production; optional for local dev. |
| `MORTGAGE_RATE` | Annual rate (e.g. `4.5`). Defaults to 4.5. |
| `TFL_APP_ID` / `TFL_APP_KEY` | Optional. TfL credentials for commute. |
| `NEXT_PUBLIC_APP_URL` | App URL. Set by Vercel or dev tunnel. |

3. **Database:** Create a Supabase project. See [PLAN.md](PLAN.md) Phase 1 for the schema. Run `supabase/migrations/` for the idempotency table.
4. **Run locally:**
   - `npm run dev` — web only
   - `npm run dev:tunnel` — full bot (needs [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/))

### Deploy

1. Deploy to [Vercel](https://vercel.com).
2. Add env vars in the Vercel dashboard, or run `npm run env:push`.
3. Point the webhook to production: `npm run use:prod`
