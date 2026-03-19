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
): Promise<IngestResult> {
  const key = computeIdempotencyKey(html, subject);
  const claimed = await claimIdempotencyKey(key);
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/index.ts:ingestAgent',message:'after claimIdempotencyKey',data:{claimed},hypothesisId:'no-msg',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
  if (!claimed) {
    return { done: true };
  }

  // Check verification first (saves listing-parse call for verification emails)
  const verification = await parseVerificationEmail(html, subject, plain);
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/index.ts:ingestAgent',message:'after parseVerificationEmail',data:{isVerification:verification.isVerification},hypothesisId:'no-msg',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
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

  const listings = await parseEmailHtml(html);
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/index.ts:ingestAgent',message:'after parseEmailHtml',data:{listingsLen:listings.length},hypothesisId:'no-msg',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion

  if (listings.length === 0) {
    await enqueueOneOffMessage(
      "Couldn't find any listings in this email — it may not be a property alert, or the format wasn't recognized.",
    );
    return { done: true };
  }

  const newIds = await deduplicateAndStore(listings);
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/index.ts:ingestAgent',message:'after deduplicateAndStore',data:{newIdsLen:newIds.length},hypothesisId:'no-msg',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion

  if (newIds.length === 0) {
    await enqueueOneOffMessage(
      "📬 Email alert processed — no new properties (all were duplicates).",
    );
    return { done: true };
  }

  return { done: false, newIds };
}
