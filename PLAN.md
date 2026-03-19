I want to build a property search automation system in Next.js (deployed on Vercel) with Supabase, Claude API, and Telegram. Here is the full plan. Build it incrementally, one phase at a time, asking me to confirm before moving to the next phase.

## Stack

- Next.js 14 (App Router) on Vercel
- Supabase (database + auth)
- Claude API (claude-sonnet-4-5) via Vercel AI SDK
- Telegram Bot API for communication
- Cloudmailin for email webhook ingestion
- TfL API for commute calculations

## Phase 1: Project scaffold + Supabase schema

Set up the Next.js project with the following structure:

/app
/api
/telegram/route.ts ← webhook receiver for Telegram messages
/ingest/route.ts ← webhook receiver for Cloudmailin emails
/evaluate/route.ts ← triggered after ingest to run evaluation pipeline
/lib
/agents
preference.ts
ingest.ts
propertyEvaluator.ts
areaEvaluator.ts
commuteEvaluator.ts
financeAgent.ts
scorecardComposer.ts
conversationAgent.ts
viewingAgent.ts
/supabase.ts ← Supabase client
openclaw/telegram.ts ← Telegram send/receive helpers
/prompts.ts ← all Claude system prompts in one place
/types
index.ts ← shared TypeScript types

Create the following Supabase tables:

preferences (
id uuid primary key,
created_at timestamptz,
updated_at timestamptz,
areas text[],
max_price integer,
min_bedrooms integer,
must_haves text[],
deal_breakers text[],
commute_anchor text,
commute_anchor_postcode text,
max_commute_minutes integer,
style_notes text,
freeform_notes text,
deposit integer,
raw_json jsonb
)

listings (
id uuid primary key,
created_at timestamptz,
portal_id text unique,
url text,
title text,
price integer,
address text,
postcode text,
bedrooms integer,
bathrooms integer,
sqft integer,
description text,
image_urls text[],
floorplan_url text,
agent_name text,
agent_email text,
listed_date date,
status text default 'pending_evaluation', -- pending_evaluation | evaluated | saved | dismissed | viewing_requested
raw_email_html text
)

evaluations (
id uuid primary key,
listing_id uuid references listings(id),
created_at timestamptz,
price_score numeric,
size_score numeric,
fit_score numeric,
area_score numeric,
commute_score numeric,
overall_score numeric,
deal_breaker_flags text[],
commute_minutes integer,
commute_route text,
monthly_mortgage numeric,
monthly_interest_only numeric,
stamp_duty numeric,
estimated_monthly_total numeric,
property_summary text,
area_summary text,
-- scorecard_text text, -- (deprecated) previously stored formatted Telegram message
raw_property_eval jsonb,
raw_area_eval jsonb,
raw_finance_eval jsonb
)

conversations (
id uuid primary key,
created_at timestamptz,
telegram_message_id text,
direction text, -- inbound | outbound
message text,
listing_id uuid references listings(id),
intent text -- view | skip | save | why | preferences | compare | other
)

Confirm schema is created before proceeding.

---

## Phase 2: Telegram bot setup

In /lib/openclaw/telegram.ts, implement:

- sendMessage(text, options) — sends a message to the hardcoded chat ID (stored in env)
- sendWithButtons(text, buttons) — sends inline keyboard buttons
- parseInbound(body) — parses incoming Telegram webhook payload, returns { text, messageId }

In /app/api/telegram/route.ts:

- Receive POST from Telegram webhook
- Parse the message
- Route to conversationAgent()
- Return 200

Add env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

Test: send a hardcoded "hello" reply to any inbound message.

---

## Phase 3: Preference Agent

In /lib/agents/preference.ts, implement a conversational agent that:

- Has a system prompt defining it as a property preference collector
- Maintains conversation state via the conversations table
- Asks the user about: target areas, budget, deposit, bedrooms, must-haves, deal-breakers, commute anchor, style preferences
- Asks follow-up questions based on answers
- When it has enough information, writes a structured preferences object to the preferences table
- Sends a confirmation summary to Telegram

In /lib/agents/conversationAgent.ts:

- If no preferences exist yet, always route to preferenceAgent
- If message is "update preferences", route to preferenceAgent
- Otherwise, handle other intents (stub them for now)

Test: complete a full preference onboarding conversation over Telegram.

---

## Phase 4: Ingest Agent

In /lib/agents/ingest.ts, implement:

- parseEmailHtml(html) — uses Claude to extract listings from Rightmove/Zoopla alert email HTML. Returns array of raw listing objects.
- deduplicateAndStore(listings[]) — checks portal_id against existing listings, inserts new ones with status pending_evaluation
- After storing, calls /api/evaluate for each new listing_id

In /app/api/ingest/route.ts:

- Receive POST from Cloudmailin webhook
- Extract HTML body
- Call ingestAgent
- Return 200

Add env var: CLOUDMAILIN_SECRET for webhook verification

Test: send a real Rightmove alert email through Cloudmailin and verify listings appear in Supabase.

---

## Phase 5: Evaluation pipeline

Build each evaluator in sequence. After each one, verify its output in Supabase before building the next.

### 5a: Property Evaluator

/lib/agents/propertyEvaluator.ts

- Takes listing + preferences
- Claude call with step-by-step reasoning
- Returns: priceScore, sizeScore, fitScore, dealBreakerFlags, propertySummary
- System prompt lives in /lib/prompts.ts

### 5b: Area Evaluator

/lib/agents/areaEvaluator.ts

- Takes listing address/postcode
- Claude call with web_search tool enabled
- Researches: crime, noise, amenities, flood risk, neighbourhood character
- Returns: areaScore, areaSummary, notableFlags[]

### 5c: Commute Evaluator

/lib/agents/commuteEvaluator.ts

- Takes property postcode + commute anchor postcode from preferences
- Calls TfL Journey Planner API (free, no key needed for basic use)
- Returns: commuteMinutes, commuteRoute, commuteScore

### 5d: Finance Agent

/lib/agents/financeAgent.ts

- Pure TypeScript maths, no Claude call needed
- Takes: price, deposit from preferences, hardcoded current best rate (stored in env as MORTGAGE_RATE, default 4.5%)
- Calculates: monthlyMortgage, monthlyInterestOnly, stampDuty, estimatedMonthlyTotal
- SDLT calculation should handle first-time buyer relief correctly

In /app/api/evaluate/route.ts:

- Takes listing_id
- Loads listing + preferences from Supabase
- Runs 5a, then 5b + 5c + 5d in parallel (Promise.all)
- Writes all results to evaluations table
- Triggers scorecardComposer

---

## Phase 6: Scorecard Composer + Telegram notification

Scorecards are constructed from evaluation and listing data at send-time
using the helpers in `lib/tools/scorecard.ts`, then sent to Telegram
with inline buttons: [View] [Save] [Skip] [Why?].

## Phase 7: Conversation Agent (full implementation)

Flesh out /lib/agents/conversationAgent.ts to handle all intents:

- view → viewingAgent.draftEmail(listingId), send draft to Telegram, await confirm/edit
- skip → update listings.status to dismissed
- save → update listings.status to saved
- why → load evaluation, ask Claude to explain scores in plain English
- update preferences → trigger preferenceAgent
- show saved → query saved listings, format and send list
- compare [A] and [B] → load both evaluations, Claude comparison prompt
- anything else → open-ended Claude chat with listing context if available

Intent detection: use a lightweight Claude call to classify the inbound message before routing.

---

## Phase 8: Viewing Agent

In /lib/agents/viewingAgent.ts:

- draftEmail(listingId) — loads listing, uses Claude to write a professional viewing request email to the agent
- sendEmail(listingId) — sends via Resend (free tier, 3000 emails/month)
- After sending, update listing status to viewing_requested, log in conversations table

Add env var: RESEND_API_KEY

---

## Phase 9: Vercel deployment + Cloudmailin + Telegram webhook wiring

- Deploy to Vercel
- Set all env vars in Vercel dashboard
- Register Telegram webhook: POST to https://api.telegram.org/bot{TOKEN}/setWebhook with Vercel URL
- Set up Cloudmailin to forward to /api/ingest
- Set up a real Rightmove/Zoopla email alert and forward to Cloudmailin address
- End-to-end test: trigger a real email alert, verify it flows through to Telegram

---

## Env vars needed (create .env.local)

ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
CLOUDMAILIN_SECRET=
MORTGAGE_RATE=4.5
RESEND_API_KEY=
TFL_APP_ID= # optional, increases TfL rate limit
TFL_APP_KEY= # optional

---

## General rules for this build

- Use TypeScript throughout, strict mode
- All Claude prompts must live in /lib/prompts.ts, not inline
- All Supabase queries go through /lib/supabase.ts
- Each agent function should be independently testable
- Never send a Telegram message without it being stored in the conversations table first
- Handle errors gracefully — if an evaluator fails, still send the scorecard with that score marked as unavailable
- After each phase, summarise what was built and what to test before asking to proceed
