# Flat Hunter

Property dashboard: search [Rightmove](https://www.rightmove.co.uk/) (sale/rent), view results in a list and on a map, save searches and favourites.

## Stack

- **Next.js** (App Router) + **TypeScript**
- **shadcn/ui** (default styling)
- **Leaflet** + OpenStreetMap
- **Supabase** (Postgres) for saved searches, cached results, and favourites
- **Python** scraper: `rightmove-webscraper` (local script + Vercel serverless `/api/scrape`)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Python (for local scraping)

Local search runs the Python scraper via `python3 scripts/rightmove_scrape.py <url>`.

```bash
pip install -r requirements.txt
# or: pip install rightmove-webscraper pandas
```

### 3. Supabase and environment

1. Create a project at [Supabase](https://supabase.com). In **SQL Editor**, run the schema once:
   - Copy and run the SQL from `supabase/schema.sql`.
2. Create `.env.local`:
   - **NEXT_PUBLIC_SUPABASE_URL** – Supabase project URL (Settings → API).
   - **SUPABASE_SERVICE_ROLE_KEY** – Service role key (Settings → API; keep secret).
   - **CRON_SECRET** (optional) – For cron endpoint; set on Vercel if you use the cron job.
   - **NEXT_PUBLIC_APP_ORIGIN** (optional) – e.g. `http://localhost:3000` for local.

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Paste a Rightmove search URL (from rightmove.co.uk after setting location/filters), click Search. Save searches and add favourites as needed.

## Deploy (Vercel)

1. Connect the repo to Vercel.
2. In Supabase, run `supabase/schema.sql` in the SQL Editor if you haven’t already.
3. In Vercel project **Settings → Environment Variables**, add:
   - **NEXT_PUBLIC_SUPABASE_URL** – your Supabase project URL.
   - **SUPABASE_SERVICE_ROLE_KEY** – your Supabase service role key (secret).
   - **CRON_SECRET** (optional) – for the cron endpoint.
4. Deploy. The Python scraper is at `/api/scrape` (Vercel runs `api/scrape.py`). Ensure `requirements.txt` is at the project root so the Python runtime gets `rightmove-webscraper`.

The app is fully serverless and works on Vercel. Cron (optional): a daily run (e.g. 08:00) refreshes cached results for saved searches; protect the route with **CRON_SECRET**.

## Rightmove

- Data comes from Rightmove only (no API; uses [rightmove-webscraper](https://github.com/toby-p/rightmove_webscraper.py)).
- Scraping may conflict with Rightmove’s terms of use; intended for personal use. Prefer limited, non-aggressive requests.
