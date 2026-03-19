# Agent Architecture

The agent is fully integrated into flat-hunter: all Telegram updates flow through `handleTelegramUpdate` in `lib/agents/handler.ts`, which routes callbacks and free text to shared tools or the conversation agent.

## Architecture

- `lib/telegram.ts` — Telegram API client (sendMessage, sendWithButtons, parseInbound, answerCallbackQuery)
- `lib/agents/handler.ts` — handleTelegramUpdate, routes all updates
- `lib/agents/notifications.ts` — consumePendingNotifications, sends ingest output
- `lib/agents/conversation.ts` — conversationAgent for free text
- `lib/core/agent.ts` — generic runAgent wrapper (multi-turn tool loop)
- `lib/core/tools/` — generic tools: call-agent, db, web-search

## Agents

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| ingest | — | — | Parse email → structured listing → DB |
| conversation | haiku-4-5 | call_agent, db, domain tools | Route user intent, delegate |
| preference | haiku-4-5 | db | Collect preferences → DB |
| property_expert | sonnet-4-6 | db, web_search | Style, floorplan, building; score property fit |
| area_expert | sonnet-4-6 | db, web_search | Vibe, crime, risks; score area |
| transport_expert | — | domain (TfL) | Commute, transport; score transport |
| finance_expert | — | domain | Mortgage, stamp duty; score financial |
| evaluator | — | pipeline | Combine expert outputs; overall score; store in evaluations |

## Telegram routing

The Telegram webhook (`/api/telegram`) parses incoming updates and calls `handleTelegramUpdate` in `lib/agents/handler.ts`:

| callback_data / text     | Action            | Fast path (no LLM) |
| ------------------------ | ----------------- | ------------------ |
| `save:{listing_id}`      | Save listing      | `saveListing`      |
| `skip:{listing_id}`      | Dismiss listing   | `skipListing`      |
| `unsave:{listing_id}`    | Remove from saved | `skipListing`      |
| `why:{listing_id}`       | Explain scores    | `getWhyContext` + explanation LLM |
| `scorecard:{listing_id}` | Re-show scorecard | `getScorecard`     |
| `update preferences`     | Show update menu  | Send update buttons |
| `update:{part}`          | Start preference flow | `collectPreferences` |
| Free text                | Conversation      | `conversationAgent` (LLM + tools) |

Domain tool implementations live in `lib/tools/listing-tools.ts`.

## Notifications (ingest handoff)

**Flow:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. `runEvaluationsAndNotify` inserts rows into `pending_notifications` (intro, scorecard, summary) and triggers `consumePendingNotifications(batch_id)`.

## Flow Summary

1. **New listings from ingest:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. Pipeline runs property/area/transport/finance experts in parallel, writes to `evaluations`. Ingest writes intro/scorecard/summary to `pending_notifications`; `consumePendingNotifications` sends to Telegram.

2. **Telegram updates:** Telegram → `/api/telegram` → `handleTelegramUpdate`. Callbacks (save/skip/why/unsave/scorecard) use fast paths; free text goes to `conversationAgent` (LLM + tools).
