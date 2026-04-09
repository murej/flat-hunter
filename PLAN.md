# Stath — Build Plan

Personal UK property search assistant. Email alerts (Rightmove, Zoopla) → CloudMailin → Claude parses + scores against preferences → Telegram scorecards with Save/Skip/Why. Conversational bot for preferences, comparisons, viewings.

## Stack

Next.js (App Router, API routes only) on **Vercel Hobby** (free tier). TypeScript, strict mode. **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) with Zod schemas. Supabase Postgres (service-role, no RLS). Telegram Bot API (raw `fetch`). CloudMailin webhook. `langmail` + `postal-mime` for email preprocessing. Listing evaluation keeps **property and area experts sequential** (Sonnet TPM); commute/finance overlap with property only.

**Dependencies**: `ai`, `@ai-sdk/anthropic`, `zod`, `@supabase/supabase-js`, `@vercel/functions`, `langmail`, `postal-mime`, `next`, `react`, `react-dom` (latest compatible versions - search the web!)

---

## Constraints

**Anthropic (Tier 1):** 50 RPM / 50K input TPM / 10K output TPM on Haiku. Same RPM on Sonnet/Opus but 30K/8K. Web search: 30/sec (not a bottleneck).

**Vercel Hobby:** 60s function timeout (`maxDuration: 60`), 100 GB-hours/month, 10 concurrent executions (queued beyond). Vercel Cron is not used (Hobby allows at most daily). Evaluation backoff uses **Supabase Cron** + `pg_net` → `GET /api/cron/evaluate`. `waitUntil` supported via `@vercel/functions`.

**External APIs:** Nominatim 1 req/sec (strict), postcodes.io generous, Police API slow, TfL 500 RPM with key, ArcGIS generous.

**Design response:**

- **50 RPM is the binding constraint.** One listing evaluation = several Sonnet/Haiku requests (~10–20s+ wall time: property then area expert sequential; commute/finance run in parallel with property only). 3 listings from one email still sequential end-to-end.
- Listings evaluated **sequentially** to avoid RPM spikes across concurrent webhooks. **Ingest** (`waitUntil`) and **cron** (`/api/cron/evaluate`) can run in parallel on Vercel — they share the same Anthropic org limits but have **no cross-process** throttle. Mitigations: `EVALUATE_CRON_BATCH_SIZE` (default 2), optional `EVALUATE_LISTING_GAP_MS` between listings in `runEvaluationsAndNotify`.
- **`evaluating` lease:** Cron claims rows via Postgres RPC with `SKIP LOCKED` (`pending_evaluation` or stale `evaluating` past `EVALUATING_STALE_MINUTES`). Ingest claims per id before `runEvaluationPipeline`. Failures release back to `pending_evaluation`; success sets `evaluated` only from `evaluating`.
- `runAgent()` retries 429/529 via AI SDK `maxRetries: 4`.
- Nominatim: `retryWithBackoff` with ≥1s base delay.
- **60s ceiling**: cron default batch 2 listings per tick; overflow picked up on the next cron run. All listings still processed eventually.
- 100 GB-hours easily covers ~10 listings/day.

**Token cost minimization:**

- Haiku everywhere by default. Sonnet/Opus only via env override.
- Web search **off** by default (adds ~2-5K input tokens per search). Enable per-expert via env.
- `Output.object()` for structured output — no parse-retry waste.
- Aggressive trimming: `slimAreaContext()`, `truncateForToolResult()`, `columnOverrides` excluding blobs, `rowShaping` truncating long fields, email input capped at 32KB, `maxTokens: 4096` output cap.

---

## Two Layers

**Layer 1 — Generic Agent Infrastructure** (`lib/core/`, `lib/utils/`): Reusable LLM agent runtime. Zero domain knowledge. Depends only on AI SDK, Zod, `@supabase/supabase-js`. Must never import from Layer 2.

**Layer 2 — Stath Application** (everything else): Domain agents, tools, prompts, schemas, config, API routes, Telegram/Supabase. Imports from Layer 1 freely.

Layer 1's configurable tools accept config objects at call time — Layer 2 passes domain-specific config in. Each layer has its own README.

---

# LAYER 1 — Generic Agent Infrastructure

```
lib/
  core/
    agent.ts              # runAgent() — thin wrapper around generateText
    types.ts              # RunAgentInput/Output, DirectToolResult, DataToolResult
    registry.ts           # Agent registration for call_agent delegation
    tools/
      index.ts            # ToolSet type, buildTools(), buildProviderTools()
      db.ts               # db_read / db_write — generic, config passed in at call time
      call-agent.ts       # call_agent — delegates to registered agent
      web-search.ts       # Anthropic native webSearch provider tool
  utils/
    env-utils.ts          # envBool(), envIntClamped(), envModel()
    retry.ts              # retryWithBackoff(), isRateLimitError(), sleep()
    tool-result.ts        # truncateForToolResult()
    agent-output.ts       # clampScore()
```

## Types (`core/types.ts`)

All domain-free.

- **RunAgentInput**: `{ systemPrompt, prompt?, tools?, providerTools?, model?, messages?, maxSteps?, telemetryTag?, output? }`
- **RunAgentOutput**: `{ message: string }`
- **DirectToolResult**: `{ type: "direct", message, payload?: Record<string, unknown> }` — `payload` is an opaque bag for app-specific data (Layer 2 puts Telegram buttons/metadata in it; Layer 1 never inspects it)
- **DataToolResult**: `{ type: "data", data: unknown, toolName }` — passed to a chained sub-agent
- **ToolResult**: `DirectToolResult | DataToolResult`

## Agent Runner (`core/agent.ts`)

Thin wrapper around `generateText()`. No domain logic, no side effects beyond LLM call + optional usage logging.

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const result = await generateText({
    model: anthropic(input.model ?? getDefaultModel()),
    system: input.systemPrompt,
    messages: input.messages,
    prompt: input.prompt,
    tools: input.tools,
    providerOptions: { anthropic: { tools: input.providerTools } },
    ...(input.output && { output: input.output }),
    stopWhen: stepCountIs(input.maxSteps ?? 5),
    maxTokens: 4096,
    maxRetries: 4, // AI SDK retries 429/529 with exponential backoff
    onStepFinish({ usage }) {
      logLlmUsage(input.telemetryTag, input.model, usage);
    },
  });
  if (input.output && result.output)
    return { message: JSON.stringify(result.output) };
  return { message: result.text };
}
```

`getDefaultModel()` reads `LLM_DEFAULT_MODEL` env (default `claude-haiku-4-5`). `logLlmUsage()` no-op unless `LLM_USAGE_LOG=true`.

### Tool Routing Pattern

Layer 2 tools short-circuit via a closure-captured variable. Layer 2 code builds the tools, calls `runAgent()`, then checks the captured result:

```typescript
let captured: ToolResult | null = null;
const tools = {
  some_action: tool({
    ...,
    execute: async (params) => {
      captured = { type: "direct", message: "Done!", payload: { buttons: [...] } };
      return "Action complete.";
    },
  }),
};
const result = await runAgent({ ..., tools });
if (captured) return captured;
return result;
```

## Registry (`core/registry.ts`)

`Map<string, AgentConfig>` — `registerAgent(name, config)` / `getAgentConfig(name)`. Config: `{ systemPrompt, tools?, providerTools?, model, maxSteps }`.

## Core Tools (`core/tools/`)

`type ToolSet = "db" | "call_agent" | "web_search"`

- `buildTools(sets, config?)` → `Record<string, CoreTool>` (Zod-based with `execute`)
- `buildProviderTools(sets)` → `ProviderTool[]` (Anthropic native)

**`db.ts`** — `db_read`/`db_write`, Zod schemas. Accepts `DbToolConfig` at call time:

```typescript
type DbToolConfig = {
  supabaseClient: SupabaseClient;
  allowlistedTables: string[];
  columnOverrides?: Record<string, string>;
  rowShaping?: Record<string, (rows: unknown[]) => unknown[]>;
};
```

**`call-agent.ts`** — `{ agent, prompt }` → registry lookup → `runAgent()`.

**`web-search.ts`** — `anthropic.tools.webSearch_20250305({ maxUses: 3 })` via `providerTools`.

## Utilities (`utils/`)

- **`env-utils.ts`**: `envBool()`, `envIntClamped()`, `envModel()`
- **`retry.ts`**: `retryWithBackoff()`, `isRateLimitError()`, `sleep()` — for external APIs only; LLM retries handled by AI SDK `maxRetries`
- **`tool-result.ts`**: `truncateForToolResult()` — cap ~8000 chars
- **`agent-output.ts`**: `clampScore(n)` — clamp [1,10]; non-finite → `null`

---

# LAYER 2 — Stath Application

```
types/index.ts                    # Domain types
lib/
  config/
    agent-models.ts               # Per-agent model getters (all default Haiku)
    conversation-llm.ts           # isCallAgentEnabled(), isReEvaluationAllowed(), constants
    expert-web-search.ts          # Expert tool set toggles, EXPERT_MAX_STEPS
    db-config.ts                  # Stath-specific DbToolConfig
  agents/
    conversation/                 # Telegram chat router
      config.ts, index.ts, handler.ts, prompts.ts, tools.ts
    ingest/                       # Email parsing + listing ingestion
      config.ts, index.ts, handler.ts, prompts.ts, tools.ts
    property-expert/              # Property appeal scoring
      config.ts, index.ts, prompts.ts, tools.ts
    area-expert/                  # Area scoring
      config.ts, index.ts, prompts.ts, tools.ts, context.ts
    preference/                   # Preference collection
      config.ts, index.ts, prompts.ts, tools.ts
    notifications.ts              # Notification queue consumer
  tools/
    area.ts                       # fetchAreaContext() — postcodes.io, Police API, ArcGIS IMD
    commute.ts                    # evaluateCommute() — TfL + Nominatim
    finance.ts                    # evaluateFinance() — mortgage, SDLT, monthly costs
    listing.ts                    # saveListing(), getScorecard(), getWhyContext(), etc.
    scorecard.ts                  # Telegram scorecard formatting
    evaluation-pipeline.ts        # runEvaluationPipeline() orchestrator
    mortgage-rate.ts              # getLatestMortgageRate()
  schemas/index.ts                # Zod schemas for structured output
  prompts/area.ts                 # Shared area evaluation prompt fragments
  telegram.ts                     # Telegram Bot API wrapper
  supabase.ts                     # Supabase client + domain query helpers
app/
  api/telegram/route.ts           # Telegram webhook
  api/ingest/route.ts             # CloudMailin webhook
  api/cron/evaluate/route.ts      # Cron: process pending_evaluation listings
supabase/schema.sql
scripts/                          # set-telegram-commands.ts, dev-tunnel.sh, telegram-webhook.sh, migrate-*.sh, deploy.sh, push-env-to-vercel.sh
```

## Database Schema

7 tables in `supabase/schema.sql`:

```sql
preferences    -- areas[], max_price, deposit, min_bedrooms, commute_anchor/postcode/max_minutes,
               --   must_haves[], deal_breakers[], style_notes, freeform_notes, area_preferences[], raw_json

listings       -- portal_id (unique), url, title, price, address, postcode, bedrooms, bathrooms,
               --   sqft, description, image_urls[], floorplan_url, agent_name/email, listed_date,
               --   status (pending_evaluation|evaluated|saved|dismissed|viewing_requested), raw_email_html

evaluations    -- listing_id FK, 5 scores + overall_score, deal_breaker_flags[], commute_minutes/route,
               --   finance fields, property_summary, area_summary, raw_property_eval/raw_area_eval jsonb, *_unknown

conversations  -- telegram_message_id, direction, message, listing_id FK, intent

ingest_idempotency   -- idempotency_key (SHA256) PK
pending_notifications -- batch_id, sequence, type, payload jsonb, consumed_at
agent_context        -- agent_id, scope, scope_value (unique triple), content jsonb, expires_at
```

## Domain Types (`types/index.ts`)

- **Preferences, Listing, Evaluation, Conversation** — mirror tables
- **ScoreWeights** — `{ appeal?, commute?, price?, size?, area? }` (0-5, default 1)
- **PropertyEvalResult, AreaEvalResult, CommuteEvalResult, FinanceEvalResult** — scores, summary, `*_unknown`, `raw` jsonb
- **TelegramPayload** — `{ buttons?, parse_mode?, metadata? }` typed shape for `DirectToolResult.payload`

## Schemas (`lib/schemas/index.ts`)

Zod schemas for `Output.object()`:

- **PropertyEvalSchema**: `{ price_score, size_score, appeal_score }` (1-10), `deal_breaker_flags[]`, `property_summary`
- **AreaEvalSchema**: `{ area_score }` (1-10), `area_summary`, `notable_flags[]`
- **VerificationResultSchema**: `{ isVerification, verificationUrl?, verificationCode? }`
- **ListingSchema**: all listing fields

## Config (`lib/config/`)

**`db-config.ts`** — `DbToolConfig` for Layer 1: `getSupabaseAdmin()` client, allowlisted tables (preferences, listings, evaluations, conversations, agent_context), column overrides excluding blobs, row shaping (descriptions 3500, messages 1500, findings 2500 chars).

**`agent-models.ts`** — Per-agent model getters, all default `claude-haiku-4-5`, overridable via env.

**`conversation-llm.ts`** — `isCallAgentEnabled()` (default true), `isReEvaluationAllowed()` (default true). Constants: `CONVERSATION_MAX_STEPS = 3`, `RE_EVAL_COOLDOWN_HOURS = 24`.

**`expert-web-search.ts`** — `getPropertyExpertToolSets()` / `getAreaExpertToolSets()` → `["db"]` or `["db", "web_search"]` (default false). Constant: `EXPERT_MAX_STEPS = 8`.

## Infrastructure

**`lib/supabase.ts`** — `getSupabaseAdmin()` (lazy singleton). Helpers: `getPreferences()`, `getListing(id)`, `updateListingStatus()`, `logConversation()` (deduped via 23505), `getConversationHistory(limit=8)` → `{ role, content }[]` truncated ~1600 chars, `getActiveListingId(lookback=10)`.

**`lib/telegram.ts`** — `sendMessage()`, `sendWithButtons()`, `sendWithReplyKeyboard()`, `parseInbound()` → `{ text, messageId, callbackQueryId? }`, `answerCallbackQuery()`. `callTelegram()` throws on non-OK responses so errors propagate to callers.

## Domain Tools

**`area.ts`** — `fetchAreaContext(postcode, targetAreas, address?)` → resolve postcode (postcodes.io), fetch crime (Police API, `retryWithBackoff`), fetch IMD (ArcGIS by LSOA), fuzzy area match. Helpers: `resolveAreaToPostcode()`, `getPostcodeContextForArea()`.

**`commute.ts`** — `evaluateCommute(fromPostcode, toPostcode, maxMinutes, address?)` → resolve origin (postcodes.io / Nominatim with ≥1s delay), TfL Journey API (`retryWithBackoff`). Score: <=50% → 10, <=75% → 8, <=100% → 6, <=125% → 4, <=150% → 2, else 1.

**`finance.ts`** — `evaluateFinance(price, deposit)` → mortgage rate (env > Supabase > 4.5% default, clamped 0.5-15%), repayment (25yr amortization), interest-only, SDLT (UK bands + FTB relief), stress test (+2%), monthly total (mortgage + £200 service charge).

**`scorecard.ts`** — `buildScorecardText()`, `buildScorecardButtons(listingId, isSaved)` (Save/Unsave + Skip + Why?), `buildNoScoreScorecardText()` fallback.

**`listing.ts`** — `saveListing()`, `skipListing()`, `getScorecard()`, `getWhyContext()`, `getComparisonData()`, `getFormattedSavedList()`, `getFormattedPreferences()`, `UPDATE_PREFERENCES_BUTTONS`.

**`evaluation-pipeline.ts`** — `runEvaluationPipeline(listingId)`:

1. Fetch listing + preferences + area context + prior agent_context
2. Run evaluators: `evaluateCommute`, `evaluateFinance`, and `runPropertyExpert` in parallel; then `runAreaExpert` (property and area experts never overlap — Sonnet TPM).
   - `runPropertyExpert` → price/size/appeal scores
   - `runAreaExpert` → area score + notable flags
   - `evaluateCommute` → commute score (no LLM)
   - `evaluateFinance` → monthly costs (no LLM)
3. Upsert agent_context, compute weighted `overall_score`, insert evaluation, build scorecard, status → "evaluated"

`runEvaluationsAndNotify(ids, { preClaimed? })` processes listings **sequentially** (~10-15s each). Cron passes `preClaimed: true` after batch claim RPC; ingest claims each id first. Overflow caught by cron within 5 min.

## Agents

### Agent `config.ts` Convention

Every agent directory contains a `config.ts` — the single place to tune that agent's behaviour. All constants have JSDoc comments. Every registered agent exports `AGENT_NAME` (registry key) and `TELEMETRY_TAG` (usage log label). Additional constants per agent:

| Agent        | Constant                     | Default                | Purpose                             |
| ------------ | ---------------------------- | ---------------------- | ----------------------------------- |
| preference   | `PREFERENCE_MAX_STEPS`       | `5`                    | Max LLM tool-use rounds             |
| ingest       | `TELEMETRY_TAG_VERIFICATION` | `"email_verification"` | Verification parse log label        |
| ingest       | `TELEMETRY_TAG_PARSE`        | `"ingest_parse"`       | Listing parse log label             |
| ingest       | `MAX_PARSE_STEPS`            | `1`                    | One-shot structured output          |
| ingest       | `MAX_INPUT_CHARS`            | `20000`                | Truncate email body before URL block |
| ingest       | `MAX_LISTING_DESCRIPTION_CHARS` | `2000`             | Cap stored listing description after parse |
| ingest       | `LISTING_URL_PATTERN_SOURCES` | (regex strings)     | Portal listing URL extraction       |
| ingest       | `INGEST_LISTING_URLS_SECTION_HEADING` | (string)      | LLM context label; referenced in `prompts.ts` |
| conversation | `TELEMETRY_TAG_WHY`          | `"why_explanation"`    | Why-chain log label                 |
| conversation | `TELEMETRY_TAG_COMPARISON`   | `"comparison"`         | Comparison-chain log label          |
| conversation | `SUB_AGENT_MAX_STEPS`        | `1`                    | Steps for why/comparison sub-agents |

Shared constants live in `lib/config/`: `EXPERT_MAX_STEPS=8` (expert-web-search.ts), `CONVERSATION_MAX_STEPS=3` / `RE_EVAL_COOLDOWN_HOURS=24` (conversation-llm.ts). `SCORECARD_DELAY_MS=500` lives at top of notifications.ts.

`lib/agents/registry-bootstrap.ts` side-effect-imports preference (sync registry) and exports `ensureDbToolAgentsRegistered()` for async property/area expert registration (db_read schema appendix).

### Preference — `lib/agents/preference/`

Registered as `"preference"`. Tools: `db`. Model: Haiku. Max steps: 5. Multi-turn preference collection (areas, price, deposit, bedrooms, commute, must-haves, deal-breakers, style). On save with `AREA_PROFILE_BATCH=true`: iterate target areas → `runAreaExpert()` per area via `getPostcodeContextForArea()` to pre-populate agent_context.

### Property Expert — `lib/agents/property-expert/`

Registered as `"property_expert"`. Tools: `db` + `web_search` (toggleable, default off). Model: Haiku (env override to Sonnet). Structured output: `Output.object({ schema: PropertyEvalSchema })`. Scores listing against preferences — price, size, appeal.

### Area Expert — `lib/agents/area-expert/`

Registered as `"area_expert"`. Tools: `db` + `web_search` (toggleable, default off). Model: Haiku (env override to Sonnet). Structured output: `Output.object({ schema: AreaEvalSchema })`. Evaluates neighbourhood via crime stats, IMD, area profiles. `context.ts`: `slimAreaContext()` trims tokens.

### Ingest — `lib/agents/ingest/`

Not registered — invoked by API route.

**`handler.ts`** — `handleIngestWebhook(request)`: CloudMailin multipart (raw RFC 5322) or JSON. HTTP Basic auth. JSON path builds context via `buildLlmContextFromParts()` in `tools.ts`. Calls `ingestAgent()`, then `waitUntil(runEvaluationsAndNotify(newIds))`.

**`config.ts`** — Telemetry tags, `MAX_PARSE_STEPS`, `MAX_INPUT_CHARS`, `LISTING_URL_PATTERN_SOURCES`, `INGEST_LISTING_URLS_SECTION_HEADING`.

**`tools.ts`** — Idempotency: `computeIdempotencyKey()`, `claimIdempotencyKey()`. Parsing: `parseVerificationEmail()`, `parseEmailHtml()`, `deduplicateAndStore()`, `runEvaluationsAndNotify()`. Email → LLM text: `extractMimeParts()`, `buildLlmContextFromParts()`, `buildLlmContextFromRaw()`, `extractListingUrls()` / `extractListingUrlsFromText()`. Listing URLs: `decodeHtmlEntitiesInUrl()`, `extractAllHrefs()`, `isLikelyListingUrl()`, `needsListingUrlRepair()` / `isGenericPortalUrl`, `derivePortalIdAndCanonicalUrl()`, `repairListingsFromEmailBody()`.

**`index.ts`** — `ingestAgent()`: idempotency → verification check → parse → `repairListingsFromEmailBody()` → dedup + store → return newIds.

**Listing refresh (same `portal_id`):** If a parsed listing’s `portal_id` already exists, compare **material listing fields** (those in `ListingSchema`: price, title, description, url, address, postcode, bedrooms, bathrooms, sqft, image_urls, floorplan_url, agent_name, agent_email, listed_date) to the stored row. If **unchanged**, skip (no DB write, no evaluation). If **changed**, `UPDATE` the row with the new parsed fields and `updated_at` (omit `status` from this patch — ingest should not set `status` here). Add that listing’s `id` to the same id list returned to the handler so `runEvaluationsAndNotify` runs `runEvaluationPipeline` and the `evaluations` row is upserted. **Note:** On completion, `runEvaluationPipeline` sets `status` to `evaluated` (same as new listings), which overwrites `saved` / `dismissed` / `viewing_requested` today; optionally extend the pipeline later to preserve terminal user statuses after ingest-refresh. **Change detection:** Prefer a stable snapshot (e.g. canonical JSON hash) to avoid noisy re-runs from ordering differences in `image_urls`.

### Conversation — `lib/agents/conversation/`

Not registered — Telegram webhook entry point.

**`handler.ts`** — routes: `/start`, `save:/skip:/unsave:`, `why:{id}`, `scorecard:{id}`, `update preferences`/`update:{category}`, default → `conversationAgent()`.

**`tools.ts`** — 11 domain tools: `show_preferences`, `show_saved_properties`, `find_listings`, `find_and_show_scorecard` (single match → scorecard with buttons), `save_listing`, `show_property_scorecard`, `evaluate_listing` (re-eval cooldown), `get_property_evaluation` (DataToolResult → explanation chain), `get_comparison_data` (DataToolResult → comparison chain), `update_preferences` (→ preference agent), plus core `db_read` / `db_write` and optional `call_agent`.

**`index.ts`** — log inbound → check prefs → resolve active listing → run agent with history → chain sub-agents on DataToolResult → send response (read payload for buttons/parse_mode) → log outbound.

**Prompts**: `CONVERSATION_AGENT_BASE` + per-mode fragments (`tool-policy` / `prompts.ts`), `WHY_EXPLANATION_SYSTEM`, `COMPARISON_SYSTEM`. **Router**: `conversation-router.ts` (structured mode enum, one step).

### Notifications — `lib/agents/notifications.ts`

`consumePendingNotifications(batchId)`: query by batch_id, send each (intro/scorecard/summary), mark consumed, 500ms delay between scorecards.

## API Routes

**`/api/telegram`** — POST. Imports `lib/agents/registry-bootstrap` (preference + `ensureDbToolAgentsRegistered`), `handleTelegramUpdate(parseInbound(body))`. Returns 200 always (prevents Telegram retries). `maxDuration = 60`. Catch block forwards error to user via `sendMessage()`. When `TELEGRAM_VERBOSE_MODE=true`, sends full error message; otherwise sends generic "Something went wrong" without details.

**`/api/ingest`** — POST. HTTP Basic auth. `handleIngestWebhook(request)`. `waitUntil()` for background eval + notify. `maxDuration = 60`.

**`/api/cron/evaluate`** — GET. Supabase Cron (`pg_cron` + `pg_net`, job `flat_hunter_evaluate_cron`, `*/5 * * * *`) calls production with `Authorization: Bearer CRON_SECRET`. Queries `pending_evaluation` listings, processes sequentially (~4 per invocation), remaining picked up next cycle. `maxDuration = 60`. Migration: [`supabase/migrations/20260321135818_evaluate_cron.sql`](supabase/migrations/20260321135818_evaluate_cron.sql).

---

## Build Order

**Layer 1:** 1. `lib/utils/` 2. `lib/core/` (types, agent, registry, tools/)

**Layer 2:** 3. Types + infra (`types/`, `lib/supabase.ts`, `lib/telegram.ts`, `supabase/schema.sql`, `supabase/migrations/`) 4. Schemas + config (`lib/schemas/`, `lib/config/`) 5. Domain tools 6. Agents (preference → property-expert → area-expert → ingest + evaluation-pipeline + notifications → conversation) 7. API routes 8. Scripts + project config (`.env.example`) 9. READMEs

---

## Environment Variables

```env
# Deployed URL
NEXT_PUBLIC_APP_URL=
CRON_SECRET=

# Layer 1
ANTHROPIC_API_KEY=
LLM_DEFAULT_MODEL=claude-haiku-4-5
LLM_USAGE_LOG=false

# Layer 2 — required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_VERBOSE_MODE=false

# Layer 2 — optional services
CLOUDMAILIN_SECRET=
TFL_APP_ID= / TFL_APP_KEY=
MORTGAGE_RATE=4.5

# Model overrides (all default claude-haiku-4-5)
PROPERTY_EXPERT_MODEL= / AREA_EXPERT_MODEL= / CONVERSATION_MODEL= / WHY_EXPLANATION_MODEL= / PREFERENCE_COLLECTOR_MODEL= / INGEST_PARSE_MODEL= / EMAIL_VERIFICATION_MODEL= / AREA_PROFILE_MODEL=

# Cost control flags
PROPERTY_EXPERT_WEB_SEARCH=false
AREA_EXPERT_WEB_SEARCH=false
CONVERSATION_CALL_AGENT=true
CONVERSATION_ALLOW_RE_EVALUATION=true
AREA_PROFILE_BATCH=false
```

## Local development

```
npm run dev -- start server, cloudflared tunnel, point Telegram bot to url
```

## Deploying

```
npm run deploy -- migrate:prod + push env + vercel deploy --prod
```

## Notes

When you finish implementing, go through this plan again step by step to identify any todos, and implment those. Once you've finished that, do this again.

---

## Verification

1. `npm run build` — zero type errors
2. `/start` → preference collection → preferences row
3. POST email to `/api/ingest` → listings + evaluations → scorecards in Telegram
4. "Why?" → explanation. "Compare with X" → comparison
5. Save/Skip → status updates
6. Same email twice → "all duplicates"
7. `pending_evaluation` listing → cron picks up within 5 min → scorecard
