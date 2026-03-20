import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseVerificationEmail,
  parseEmailHtml,
  deduplicateAndStore,
  enqueueOneOffMessage,
  type IngestResult,
} from "./tools";

export type { IngestResult, RawListing } from "./tools";
export {
  computeIdempotencyKey,
  claimIdempotencyKey,
  runEvaluationsAndNotify,
} from "./tools";

export async function ingestAgent(
  html: string,
  subject?: string,
  plain?: string,
  rawMessage?: string,
): Promise<IngestResult> {
  const key = computeIdempotencyKey(html, subject, plain);
  const claimed = await claimIdempotencyKey(key);
  if (!claimed) {
    // #region agent log
    fetch(
      "http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "80f195",
        },
        body: JSON.stringify({
          sessionId: "80f195",
          runId: "post-fix",
          hypothesisId: "A",
          location: "ingest/index.ts:idempotency",
          message: "duplicate idempotency — enqueueing user notice",
          data: { keyPrefix: key.slice(0, 16) },
          timestamp: Date.now(),
        }),
      },
    ).catch(() => {});
    // #endregion
    await enqueueOneOffMessage(
      "📬 This email was already processed (same content as before — e.g. a duplicate forward or provider retry). Nothing new was added.",
      { parse_mode: false },
    );
    return { done: true };
  }

  // Check verification first (saves listing-parse call for verification emails)
  const verification = await parseVerificationEmail(
    html,
    subject,
    plain,
    rawMessage,
  );
  if (verification.isVerification) {
    if (verification.verificationUrl) {
      await enqueueOneOffMessage(
        `📬 New subscription detected. Please click the link below to verify your email:\n\n${verification.verificationUrl}`,
        { parse_mode: false },
      );
    } else if (verification.verificationCode) {
      await enqueueOneOffMessage(
        `📬 New subscription detected. Your verification code is: *${verification.verificationCode}*\n\nEnter it on the verification page to activate your alerts.`,
      );
    } else {
      await enqueueOneOffMessage(
        "📬 This looks like a verification email. Please check your inbox and click the verification link (or enter the code) to activate your alerts.",
      );
    }
    return { done: true };
  }

  // #region agent log
  fetch(
    "http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "80f195",
      },
      body: JSON.stringify({
        sessionId: "80f195",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "ingest/index.ts:after-verification",
        message: "past verification — parsing listings",
        data: { htmlLen: html.length },
        timestamp: Date.now(),
      }),
    },
  ).catch(() => {});
  // #endregion
  const listings = await parseEmailHtml(html, subject, rawMessage);

  if (listings.length === 0) {
    await enqueueOneOffMessage(
      "Couldn't find any listings in this email — it may not be a property alert, or the format wasn't recognized.",
    );
    return { done: true };
  }

  const newIds = await deduplicateAndStore(listings, html || plain || "");

  if (newIds.length === 0) {
    await enqueueOneOffMessage(
      "📬 Email alert processed — no new properties (all were duplicates).",
    );
    return { done: true };
  }

  return { done: false, newIds };
}
