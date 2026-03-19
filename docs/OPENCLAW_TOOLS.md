# Openclaw Tool Integration

This document describes the backend HTTP tools and the Openclaw agent. Openclaw is fully integrated into flat-hunter: all Telegram updates flow through `handleTelegramUpdate` in `lib/openclaw/agent.ts`, which routes callbacks and free text to shared tools or the conversation agent.

## Architecture

All Telegram communication lives in `lib/openclaw/`:

- `lib/openclaw/telegram.ts` — Telegram API client (sendMessage, sendWithButtons, parseInbound, answerCallbackQuery)
- `lib/openclaw/agent.ts` — handleTelegramUpdate, routes all updates
- `lib/openclaw/notifications.ts` — consumePendingNotifications, sends ingest output
- `lib/openclaw/conversation.ts` — conversationAgent for free text

## Base URL

Replace `{APP_URL}` with your deployed app URL (e.g. `https://your-app.vercel.app` or your tunnel URL during development).

## Tools

### get_preferences

**GET** `{APP_URL}/api/openclaw/tools/get_preferences`

Returns the user's current search preferences.

**Response:**

```json
{
  "preferences": { "areas": [...], "max_price": 650000, ... } | null
}
```

---

### get_listing

**POST** `{APP_URL}/api/openclaw/tools/get_listing`

**Body:** `{ "listing_id": "uuid" }`

Returns a single listing by ID.

**Response:**

```json
{
  "listing": { "id": "...", "title": "...", "price": 450000, "address": "...", "url": "...", ... }
}
```

---

### evaluate_listing

**POST** `{APP_URL}/api/openclaw/tools/evaluate_listing`

**Body:** `{ "listing_id": "uuid" }`

Runs the full evaluation pipeline (property fit, area, commute, finance). Does not send Telegram. Returns the scorecard text and buttons for Openclaw to send.

**Response:**

```json
{
  "scorecardText": "🏠 **Property title**\n...",
  "buttons": [
    [
      { "text": "💾 Save", "callback_data": "save:{listing_id}" },
      { "text": "⏭ Skip", "callback_data": "skip:{listing_id}" },
      { "text": "❓ Why?", "callback_data": "why:{listing_id}" }
    ]
  ],
  "listingId": "uuid",
  "overall_score": 7.2,
  "unknownScores": { "property": false, "area": false, "commute": false },
  "shouldSendNoScore": false
}
```

When the listing is already saved, the Save button becomes "🗑 Unsave" with `callback_data: "unsave:{listing_id}"`.

---

### save_listing

**POST** `{APP_URL}/api/openclaw/tools/save_listing`

**Body:** `{ "listing_id": "uuid" }`

Marks the listing as saved (shortlisted).

**Response:**

```json
{ "ok": true, "status": "saved" }
```

---

### skip_listing

**POST** `{APP_URL}/api/openclaw/tools/skip_listing`

**Body:** `{ "listing_id": "uuid" }`

Marks the listing as dismissed.

**Response:**

```json
{ "ok": true, "status": "dismissed" }
```

---

### why_listing

**POST** `{APP_URL}/api/openclaw/tools/why_listing`

**Body:** `{ "listing_id": "uuid" }`

Returns the evaluation context (property + evaluation JSON) for Openclaw to generate a plain-English explanation of the scores.

**Response:**

```json
{
  "context": "Property: ... at ... (£...)\n\nEvaluation:\n{ ... }",
  "listing": { "title": "...", "address": "...", "price": ... },
  "evaluation": { "price_score": 7, "fit_score": 8, ... }
}
```

---

### get_saved_properties

**GET** `{APP_URL}/api/openclaw/tools/get_saved_properties`

Returns all saved listings.

**Response:**

```json
{
  "listings": [
    {
      "id": "uuid",
      "title": "...",
      "price": 450000,
      "address": "...",
      "url": "..."
    }
  ]
}
```

---

## Telegram routing (internal)

The Telegram webhook (`/api/telegram`) parses incoming updates and calls `handleTelegramUpdate` in `lib/openclaw/agent.ts`. All routing is handled by the agent:

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

Shared tool implementations live in `lib/openclaw/tools.ts` and are used by both the agent and the HTTP routes.

---

## Openclaw Tool Schema (for tool definition)

Define these tools in your Openclaw workspace so the agent can call them. Example schema format:

```json
{
  "name": "evaluate_listing",
  "description": "Evaluate a property listing and get scorecard text + buttons to send to the user.",
  "parameters": { "listing_id": "string (UUID)" }
}
```

Repeat for `get_preferences`, `get_listing`, `save_listing`, `skip_listing`, `why_listing`, `get_saved_properties`.

---

## Notifications (ingest handoff)

Openclaw is part of the flat-hunter service. Ingest no longer sends Telegram directly; it writes to `pending_notifications` and triggers an internal consumer.

**Flow:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. `runEvaluationsAndNotify` inserts rows into `pending_notifications` (intro, scorecard, summary) and triggers `consumePendingNotifications(batch_id)`. In production (Vercel), `waitUntil` runs the consumer in the background; in local dev, the consumer is awaited directly so messages are sent.

**Payload shapes:**

| type       | payload                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `intro`    | `{ "kind": "no_prefs" \| "new_listings" \| "truncated", "text": string, "truncatedTotal"?: number }` |
| `scorecard`| `{ "listingId", "scorecardText", "buttons", "overall_score", "shouldSendNoScore" }` |
| `summary`  | `{ "text": string }`                                                    |

---

## Flow Summary

1. **New listings from ingest:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. Ingest writes intro/scorecard/summary to `pending_notifications`; `consumePendingNotifications` sends to Telegram.

2. **Telegram updates:** Telegram → `/api/telegram` → `handleTelegramUpdate`. Callbacks (save/skip/why/unsave/scorecard) use fast paths; free text goes to `conversationAgent` (LLM + tools).

3. **HTTP tools:** External callers can use the same logic via `GET/POST` endpoints under `/api/openclaw/tools/`. These call the shared functions in `lib/openclaw/tools.ts`.
