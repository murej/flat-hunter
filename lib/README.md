# Layer 2 — Stath Application

Domain-specific agents, tools, configuration, and schemas. Imports from [Layer 1](core/README.md) freely.

## Agents (`agents/`)

### Conversation (`agents/conversation/`)

Telegram webhook entry point. Routes: `/start`, `save:/skip:/unsave:`, `why:{id}`, `scorecard:{id}`, `update preferences`, and default free-text chat. 10 domain tools plus core tools (db_read, db_write, call_agent), including `find_listings` for non-UUID lookup. Supports DataToolResult chaining for why-explanation and comparison sub-agents.

### Ingest (`agents/ingest/`)

CloudMailin email processing. Idempotency via SHA256 key. Pipeline: verification check, HTML parsing via structured output, deduplication by portal_id, store as `pending_evaluation`. Background evaluation + notification via `waitUntil`.

### Preference (`agents/preference/`)

Multi-turn preference collection (areas, price, deposit, bedrooms, commute, must-haves, deal-breakers, style). Registered as `"preference"` for call_agent delegation. Optional batch area profiling on save.

### Property Expert (`agents/property-expert/`)

Registered as `"property_expert"`. Scores listings against preferences — price, size, appeal (1-10). Structured output via `Output.object()`. Web search toggleable via env.

### Area Expert (`agents/area-expert/`)

Registered as `"area_expert"`. Evaluates neighbourhood quality via crime stats, IMD deprivation index, and area profiles. `context.ts` provides `slimAreaContext()` for token trimming. Web search toggleable via env.

### Notifications (`agents/notifications.ts`)

Queue consumer for `pending_notifications`. Sends intro, scorecards (with 500ms delay), and summary messages to Telegram.

### Registry bootstrap (`agents/registry-bootstrap.ts`)

Side-effect import of `preference/` registers that agent synchronously. Exports `ensureDbToolAgentsRegistered()` to register `property_expert` and `area_expert` with async-built tools (db_read schema RPC). API entrypoints (e.g. Telegram) import this module and await `ensureDbToolAgentsRegistered()` before handling requests that use experts or `call_agent`.

## Tools (`tools/`)

| File | Purpose |
|------|---------|
| `evaluation-pipeline.ts` | Orchestrates evaluators (commute+finance+property parallel, then area expert), computes weighted overall score, upserts evaluation |
| `highlights.ts` | `generateHighlights()` — LLM step for 3–7 scorecard match bullets; uses [`prompts/highlights.ts`](prompts/highlights.ts) |
| `area.ts` | `fetchAreaContext()` — postcodes.io, Police API crime data, ArcGIS IMD by LSOA |
| `commute.ts` | `evaluateCommute()` — TfL Journey Planner + Nominatim geocoding |
| `finance.ts` | `evaluateFinance()` — mortgage repayment, interest-only, SDLT with FTB relief, stress test |
| `listing.ts` | `saveListing()`, `skipListing()`, `getScorecard()`, `getWhyContext()`, `getComparisonData()` |
| `scorecard.ts` | `buildScorecardText()`, `buildScorecardButtons()` for Telegram inline keyboards |
| `mortgage-rate.ts` | `getLatestMortgageRate()` — env > Supabase > 4.5% default, clamped 0.5-15% |

## Config (`config/`)

| File | Purpose |
|------|---------|
| `agent-models.ts` | Per-agent model getters, all default `claude-haiku-4-5`, env-overridable |
| `db-config.ts` | `DbToolConfig` with table allowlist, column overrides, row shaping |
| `conversation-llm.ts` | `isCallAgentEnabled()`, `isReEvaluationAllowed()`, `CONVERSATION_MAX_STEPS`, `RE_EVAL_COOLDOWN_HOURS` |
| `expert-web-search.ts` | `getPropertyExpertToolSets()`, `getAreaExpertToolSets()`, `EXPERT_MAX_STEPS` |

## Schemas (`schemas/`)

Zod schemas for `Output.object()` structured output: `PropertyEvalSchema`, `AreaEvalSchema`, `VerificationResultSchema`, `ListingSchema`.

## Prompts (`prompts/`)

Shared prompt fragments. `area.ts` contains reusable area evaluation prompt components.

## Infrastructure

- `supabase.ts` — `getSupabaseAdmin()` (lazy singleton) + helpers: `getPreferences()`, `getListing()`, `updateListingStatus()`, `logConversation()`, `getConversationHistory()`, `getActiveListingId()`
- `telegram.ts` — `sendMessage()`, `sendWithButtons()`, `sendWithReplyKeyboard()`, `parseInbound()`, `answerCallbackQuery()`
