# Flat Hunter — Stress Test Analysis & Fix Plan

## Executive Summary

The app processes property alert emails, parses listings with AI, evaluates them (area, commute, finance), and sends scorecards via Telegram. Under stress—especially a single email with many listings—several failure modes emerge: API rate limits, timeouts, and silent failures.

---

## 1. Stress Points Identified

### 1.1 Ingest: Unbounded Parallel Evaluations (Critical)

**Location:** `lib/tools/ingest.ts` → `runEvaluationsAndNotify`

```typescript
const evalResults = await Promise.all(
  newIds.map((id) => runEvaluationPipeline(id, { sendImmediately: false }).catch(...))
);
```

**Problem:** One Rightmove/Zoopla alert can contain 10–50+ listings. All evaluations run in parallel. Each evaluation triggers:

- 1 Anthropic call (combined evaluator)
- 1 area-context call → postcodes.io (1–3 calls), police.uk (3 calls), arcgis (1 call), optionally Claude for area profiles
- 1 commute call → Nominatim, postcodes.io, TfL
- 1 finance call (local, no API)

**Result:** 20 listings ≈ 20+ Anthropic calls + 60+ postcodes.io + 60 police.uk + 20 TfL + 20 Nominatim in parallel.

**Impact:**
- Anthropic 429 (rate limit)
- Postcodes.io 429 (free tier, no key)
- Nominatim 429 (1 req/sec for free)
- TfL rate limits
- Vercel function timeout (ingest `maxDuration = 60`)

---

### 1.2 Ingest: Large Email HTML (Medium)

**Location:** `lib/utils/email-html.ts` → `extractTextAndUrlsFromHtml`

**Problem:** Full HTML is passed to `html-to-text` and to Claude. No size cap. Very large digests (e.g. 50 listings with images) can:

- Exceed Claude context limits
- Cause memory pressure
- Slow parsing

---

### 1.3 Telegram Webhook: Silent Failures (Critical)

**Location:** `app/api/telegram/route.ts`

```typescript
} catch (error) {
  console.error("Telegram webhook error:", error);
  return NextResponse.json({ ok: true });  // Always 200
}
```

**Problem:** On any error, the handler returns 200. Telegram assumes success and will not retry. The user gets no response and no error message.

---

### 1.4 Telegram: Rate Limits (Medium)

**Location:** `lib/tools/ingest.ts` → `runEvaluationsAndNotify`

**Problem:** Scorecards are sent sequentially with `SCORECARD_DELAY_MS = 500`. Telegram allows ~30 msg/sec to the same chat. With 30 scorecards, this is ~15s. Acceptable, but if delay is removed or reduced, rate limits could be hit.

---

### 1.5 External APIs: No Concurrency Control (Critical)

**Locations:** `area-context.ts`, `commute.ts`, `ingest.ts`

**Problem:**
- Postcodes.io: no API key, rate limited
- Nominatim: 1 req/sec for free tier
- Police.uk: no documented limit but can throttle
- TfL: rate limits
- Anthropic: tier-based limits

**Impact:** Burst traffic causes 429s. `retryWithBackoff` helps but retries add more load; no global throttling.

---

### 1.6 waitUntil: Background Task Limits (Medium)

**Location:** `app/api/ingest/route.ts`

```typescript
waitUntil(runEvaluationsAndNotify(result.newIds));
return NextResponse.json({ ok: true });
```

**Problem:** `waitUntil` runs after the response. On Vercel, background work continues until the function times out. For many listings, evaluations may not finish before the process is killed.

---

### 1.7 Evaluate API: Unauthenticated (Low)

**Location:** `app/api/evaluate/route.ts`

**Problem:** Anyone can POST to `/api/evaluate` with a `listing_id` and trigger evaluations. Abuse could exhaust Anthropic credits and API quotas.

---

### 1.8 Idempotency: No Cleanup (Low)

**Location:** `supabase/schema.sql` → `ingest_idempotency`

**Problem:** Idempotency keys are never deleted. Table grows indefinitely.

---

## 2. Fix Plan

### Phase 1: Critical — Evaluation Concurrency

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Add concurrency limit to `runEvaluationsAndNotify` (e.g. 3–5 concurrent evaluations) | Low | Prevents Anthropic/API rate limits |
| P0 | Use `p-limit` or `p-queue` for controlled parallelism | Low | Same |

**Implementation:**
- Add `p-limit` (or similar) to `runEvaluationsAndNotify`
- Process evaluations in batches of 3–5 instead of `Promise.all`

---

### Phase 2: Critical — Telegram Error Handling

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | On error, attempt to send a user-facing error message via Telegram before returning | Low | User sees feedback |
| P0 | Consider returning 5xx for transient errors so Telegram retries (with caveats) | Low | Improves reliability |

**Implementation:**
- In catch block: try `sendMessage("Something went wrong. Please try again.")` (with retry)
- Document: Telegram retries on 5xx; ensure idempotency for message handling

---

### Phase 3: High — API Throttling

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P1 | Add global rate limiter for external APIs (postcodes.io, Nominatim, TfL) | Medium | Reduces 429s |
| P1 | Add retry with exponential backoff to Telegram `sendMessage` | Low | Handles transient failures |

**Implementation:**
- Create `lib/utils/rate-limiter.ts` with per-domain limits
- Wrap fetch calls in area-context, commute with limiter
- Or use `p-limit` per domain (e.g. 2 concurrent for postcodes.io)

---

### Phase 4: High — Ingest Size Limits

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P1 | Truncate email content before Claude (e.g. 50KB max) | Low | Prevents context overflow |
| P1 | Cap number of listings processed per email (e.g. 100) | Low | Prevents runaway evaluation |

**Implementation:**
- In `parseEmailHtml`, truncate `content` before sending to Claude
- In `runEvaluationsAndNotify`, slice `newIds` to first 100

---

### Phase 5: Medium — Background Processing

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P2 | Move long-running evaluations to a queue (e.g. Supabase Edge Function, Inngest, or Vercel Cron) | High | Reliable completion |
| P2 | Or: process first N listings immediately, queue rest | Medium | Partial improvement |

**Implementation:**
- Option A: Supabase `pg_net` or Edge Function to trigger evaluations
- Option B: Inngest/Trigger.dev for background jobs
- Option C: Vercel Cron + DB table for "pending evaluation" jobs

---

### Phase 6: Medium — Security & Hygiene

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P2 | Add auth to `/api/evaluate` (e.g. `CLOUDMAILIN_SECRET`-style header or internal token) | Low | Prevents abuse |
| P2 | Add cron job to prune `ingest_idempotency` (e.g. delete keys older than 7 days) | Low | Keeps table small |

---

### Phase 7: Low — Observability

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P3 | Add structured logging (e.g. listing count, duration, error type) | Low | Easier debugging |
| P3 | Add Sentry or similar for error tracking | Low | Visibility into failures |

---

## 3. Recommended Implementation Order

1. **Week 1:** Phase 1 (concurrency limit) + Phase 2 (Telegram error handling)
2. **Week 2:** Phase 4 (size limits) + Phase 6 (evaluate auth, idempotency cleanup)
3. **Week 3:** Phase 3 (API throttling)
4. **Later:** Phase 5 (queue) if needed; Phase 7 (observability)

---

## 4. Quick Wins (Can Do Today)

1. Add `p-limit` to `runEvaluationsAndNotify` (e.g. 3 concurrent)
2. In Telegram catch block: try `sendMessage("Something went wrong. Please try again.")`
3. Truncate `content` in `parseEmailHtml` to 50KB
4. Slice `newIds` to first 100 in `runEvaluationsAndNotify`

---

## 5. Stress Test Scenarios

| Scenario | Expected Behavior | How to Test |
|----------|-------------------|-------------|
| Email with 30 listings | Evaluations complete without 429s; user gets scorecards | Forward real Rightmove digest |
| Email with 100 listings | First 100 processed; no crash | Synthetic email |
| Rapid Telegram messages (5 in 2s) | All handled or graceful degradation | Manual |
| Anthropic 429 | User sees "try again in a minute" | Mock or exhaust quota |
| Cloudmailin retry (same email) | Idempotency prevents duplicate processing | Same payload twice |

---

## 6. Dependencies to Add

```json
{
  "p-limit": "^4.0.0"
}
```

(Note: p-limit v5 uses Node async_hooks and may not resolve correctly in Next.js; v4 is used for compatibility.)

---

## 7. Appendix: External API Rate Limits (Reference)

| API | Limit | Notes |
|-----|-------|-------|
| Anthropic | Tier-based | 429 on rate limit |
| Postcodes.io | 100 req/day (no key) | Free, UK only |
| Nominatim | 1 req/sec | Free, requires User-Agent |
| Police.uk | Unknown | Free |
| TfL | Unknown | Requires app_id/app_key |
| Telegram | 30 msg/sec to same chat | Per bot |
