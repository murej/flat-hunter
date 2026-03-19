# Agent Architecture

The agent is fully integrated into flat-hunter: all Telegram updates flow through `handleTelegramUpdate` in `lib/agent/core.ts`, which routes callbacks and free text to shared tools or the conversation agent.

## Architecture

All Telegram communication lives in `lib/agent/`:

- `lib/agent/telegram.ts` — Telegram API client (sendMessage, sendWithButtons, parseInbound, answerCallbackQuery)
- `lib/agent/core.ts` — handleTelegramUpdate, routes all updates
- `lib/agent/notifications.ts` — consumePendingNotifications, sends ingest output
- `lib/agent/conversation.ts` — conversationAgent for free text

## Telegram routing

The Telegram webhook (`/api/telegram`) parses incoming updates and calls `handleTelegramUpdate` in `lib/agent/core.ts`. All routing is handled by the agent:

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

Shared tool implementations live in `lib/agent/tools.ts` and are used by the agent.

## Notifications (ingest handoff)

The agent is part of the flat-hunter service. Ingest no longer sends Telegram directly; it writes to `pending_notifications` and triggers an internal consumer.

**Flow:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. `runEvaluationsAndNotify` inserts rows into `pending_notifications` (intro, scorecard, summary) and triggers `consumePendingNotifications(batch_id)`. In production (Vercel), `waitUntil` runs the consumer in the background; in local dev, the consumer is awaited directly so messages are sent.

**Payload shapes:**

| type       | payload                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `intro`    | `{ "kind": "no_prefs" \| "new_listings" \| "truncated", "text": string, "truncatedTotal"?: number }` |
| `scorecard`| `{ "listingId", "scorecardText", "buttons", "overall_score", "shouldSendNoScore" }` |
| `summary`  | `{ "text": string }`                                                    |

## Flow Summary

1. **New listings from ingest:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. Ingest writes intro/scorecard/summary to `pending_notifications`; `consumePendingNotifications` sends to Telegram.

2. **Telegram updates:** Telegram → `/api/telegram` → `handleTelegramUpdate`. Callbacks (save/skip/why/unsave/scorecard) use fast paths; free text goes to `conversationAgent` (LLM + tools).
