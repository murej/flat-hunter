# Openclaw Tool Integration

This document describes the backend HTTP tools exposed for Openclaw. Openclaw owns Telegram conversation and sending; the flat-hunter Next.js backend provides evaluation, scorecard generation, and data access.

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

## Callback Handling

When the user taps an inline keyboard button, Telegram sends a `callback_query` with `data` set to the `callback_data` value. Openclaw should parse and route:

| callback_data            | Action            | Tool to call                                                        |
| ------------------------ | ----------------- | ------------------------------------------------------------------- |
| `save:{listing_id}`      | Save listing      | `save_listing`                                                      |
| `skip:{listing_id}`      | Dismiss listing   | `skip_listing`                                                      |
| `why:{listing_id}`       | Explain scores    | `why_listing` → then generate explanation from `context`            |
| `unsave:{listing_id}`    | Remove from saved | `skip_listing` (or add `unsave_listing` if you prefer)              |
| `scorecard:{listing_id}` | Re-show scorecard | `evaluate_listing` (or fetch existing evaluation + build scorecard) |

For `unsave`, the current backend treats "unsave" as dismissing. If you want to keep the listing but remove from shortlist, you would need an `unsave_listing` tool that sets status back to `evaluated`. The current agent uses `updateListingStatus(listingId, "dismissed")` for unsave.

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

**Flow:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. `runEvaluationsAndNotify` inserts rows into `pending_notifications` (intro, scorecard, summary) and calls `consumePendingNotifications(batch_id)` via `waitUntil`. The consumer (`lib/openclaw/notifications.ts`) fetches pending rows, sends each to Telegram via `sendMessage` / `sendWithButtons`, and marks them consumed.

**Payload shapes:**

| type       | payload                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `intro`    | `{ "kind": "no_prefs" \| "new_listings" \| "truncated", "text": string, "truncatedTotal"?: number }` |
| `scorecard`| `{ "listingId", "scorecardText", "buttons", "overall_score", "shouldSendNoScore" }` |
| `summary`  | `{ "text": string }`                                                    |

---

## Flow Summary

1. **New listings from ingest:** Cloudmailin → `/api/ingest` → `ingestAgent` parses emails, stores listings, calls `runEvaluationsAndNotify`. Ingest writes intro/scorecard/summary to `pending_notifications`; `consumePendingNotifications` sends to Telegram.

2. **User asks for evaluation:** Openclaw calls `evaluate_listing` → receives `scorecardText` + `buttons` → sends to Telegram via its channel.

3. **User taps Save/Skip/Why:** Openclaw receives callback → calls `save_listing` / `skip_listing` / `why_listing` → sends confirmation or explanation to Telegram.
