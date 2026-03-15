# Property dashboard – plan

## Scope

- **Data:** Rightmove only (Python `rightmove-webscraper`). Sale and rent via pasted search URL.
- **Persistence:** Saved searches + favourites; single user, no auth. **Storage:** Supabase (Postgres)—deploys on Vercel.
- **Stack:** Next.js (App Router) + React, [shadcn/ui](https://ui.shadcn.com/) default styling, Leaflet + OpenStreetMap. Deploy on **Vercel**.
- **Search:** On-demand when user clicks Search; optional cron to refresh cached results for saved searches.

---

## User flows

**1. Search and view** — Paste Rightmove search URL (or pick saved search) → Search → Loading (10–30 s) → List + map. From list: Save search (name + URL) or Add to favourites (URL + snapshot).

**2. Saved searches** — Open saved search → show cached results in list + map; optional Refresh to re-scrape. Optional cron refreshes all saved searches (e.g. daily).

**3. Favourites** — List + map of saved properties; remove as needed.

---

## Architecture

```mermaid
flowchart LR
  subgraph frontend [Next.js + shadcn/ui]
    Filters[Search URL / saved search]
    List[List view]
    Map[Map view]
    Filters --> List
    Filters --> Map
  end

  subgraph api [Next.js API]
    Search[/api/search]
    Saved[/api/saved-searches]
    Fav[/api/favourites]
    Cron[/api/cron/refresh]
  end

  subgraph data [Data]
    Scraper[Python scraper]
    DB[(Supabase)]
  end

  frontend --> Search
  frontend --> Saved
  frontend --> Fav
  Search --> Scraper
  Search --> DB
  Saved --> DB
  Fav --> DB
  Cron --> Scraper
  Cron --> DB
```

---

## Implementation

### Setup

- Next.js (App Router, TypeScript). `npx shadcn@latest init` with defaults; add components as needed: `button`, `input`, `card`, `select`, `tabs`, `skeleton`, `toast`, etc.
- Supabase. Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Run `supabase/schema.sql` in Supabase SQL Editor once.

### Scraper

- **Vercel Python serverless function** (e.g. `api/scrape.py`): accepts Rightmove URL (query/body), runs `rightmove-webscraper`, returns JSON. `requirements.txt`: `rightmove-webscraper`. Next.js `POST /api/search` calls it (e.g. `fetch(origin + '/api/scrape?url=' + encodeURIComponent(url))`). If Vercel Python is unsuitable, use a small external Python service and call it from the API route.

### Data layer

- **Schema:** `saved_searches`, `cached_results`, `favourites` (see `supabase/schema.sql`). Single `lib/db.ts` with `@supabase/supabase-js`. Run schema in Supabase SQL Editor once.

### API routes

| Route | Behaviour |
|-------|-----------|
| POST /api/search | Body: `{ rightmoveUrl }` or `{ savedSearchId }`. Call scrape (or use cache when savedSearchId); return `{ results }`; optionally write cache. |
| GET/POST/DELETE /api/saved-searches | List, create (name + url), delete. |
| GET/POST/DELETE /api/favourites | List, add (property_url + snapshot), remove. |
| POST /api/cron/refresh-saved-searches | For each saved search, scrape and update cached_results. Require `CRON_SECRET` header. |

### Frontend

- **Search:** `Input` (Rightmove URL), `Select` or list (saved searches), `Button` (Search, Save search). `Skeleton` while loading; `Toast` for success.
- **List:** Reusable component with shadcn `Card` per property (image, price, address, beds, link, Add to favourites). Reused for search results, saved-search results, and favourites.
- **Map:** Leaflet + OSM in a client component; markers from results; click marker ↔ highlight list row.
- **Nav:** shadcn `Tabs`: Search | Saved searches | Favourites.

### File structure

- `app/page.tsx` — Dashboard (tabs, search form, list + map). `app/layout.tsx`, `app/globals.css`.
- `app/api/search/route.ts`, `app/api/saved-searches/route.ts`, `app/api/favourites/route.ts`, `app/api/cron/refresh-saved-searches/route.ts`.
- `app/api/scrape.py` — Python serverless function (or separate service).
- `lib/db.ts` — Supabase client and helpers. `lib/supabase.ts` — createClient. `supabase/schema.sql` — table definitions.
- `components/ui/*` — shadcn. `components/PropertyList.tsx`, `MapView.tsx`, `SearchForm.tsx` — shadcn only, default styling.
- `requirements.txt` — `rightmove-webscraper`.

### Cron

- In `vercel.json` (or project settings): cron target `POST /api/cron/refresh-saved-searches` with `CRON_SECRET` header; e.g. daily.

---

## Out of scope (v1)

Auth; structured filters (paste URL only); email notifications; other portals; custom shadcn theme.

---

## Risks

- **Rightmove:** ~42 pages / ~1,050 listings max; slow scrape → use Skeleton and cache.
- **Scraper:** Site changes can break; single scrape endpoint to fix.
- **Vercel:** Python cold start and timeout (~30 s) → clear loading state; long scrapes may need external worker later.
- **ToS:** Scraping not permitted by Rightmove; personal use, rate-limit, no redistribution.
