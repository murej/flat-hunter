import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseEmail,
  deduplicateAndStore,
} from "./tools";
import type { DeduplicateResult } from "./tools";
import {
  buildLlmContextFromParts,
  buildLlmContextFromRaw,
} from "./email-llm-input";
import { validateAndCleanListings } from "./validation";
import { reportError } from "@/lib/core/reporting";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";
import { envBool } from "@/lib/utils/env-utils";

export type IngestResult = {
  newIds: string[];
  updatedIds: string[];
  changes: DeduplicateResult["changes"];
};

export async function ingestAgent(
  content: string,
  isRaw: boolean,
  rawEmail: string,
): Promise<IngestResult> {
  const empty: IngestResult = {
    newIds: [],
    updatedIds: [],
    changes: new Map(),
  };

  // Build LLM-friendly content
  let llmResult;
  if (isRaw) {
    llmResult = await buildLlmContextFromRaw(content);
  } else {
    const { html, plain, subject } = JSON.parse(content) as {
      html: string;
      plain: string;
      subject: string;
    };
    llmResult = buildLlmContextFromParts(html, subject, plain);
  }

  const llmContent = llmResult.context;

  if (llmResult.truncated) {
    await reportError(
      new Error(`Email content truncated to ${llmContent.length} chars`),
      { source: "ingest/truncation" },
    );
  }

  // Idempotency check
  const key = computeIdempotencyKey(llmContent);
  const claimed = await claimIdempotencyKey(key);
  if (!claimed) {
    console.log("Duplicate email, skipping.");
    return empty;
  }

  // Parse email: classify (verification vs property alert) and extract listings in one call
  const parseResult = await parseEmail(llmContent);

  if (parseResult.isVerification) {
    // #region agent log
    fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a6a391'},body:JSON.stringify({sessionId:'a6a391',location:'ingest/index.ts:68',message:'verification branch entered',data:{verificationUrl:parseResult.verificationUrl,verificationUrlType:typeof parseResult.verificationUrl,verificationCode:parseResult.verificationCode,verificationCodeType:typeof parseResult.verificationCode,urlIsTruthy:!!parseResult.verificationUrl,codeIsTruthy:!!parseResult.verificationCode},timestamp:Date.now(),hypothesisId:'H-A,H-B,H-C'})}).catch(()=>{});
    // #endregion
    const msg = parseResult.verificationUrl
      ? `🔐 Verification email received.\nURL: ${parseResult.verificationUrl}`
      : parseResult.verificationCode
        ? `🔐 Verification code: ${parseResult.verificationCode}`
        : "🔐 Verification email received (no URL/code extracted).";
    // #region agent log
    fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a6a391'},body:JSON.stringify({sessionId:'a6a391',location:'ingest/index.ts:74',message:'verification message built',data:{msg},timestamp:Date.now(),hypothesisId:'H-A,H-B,H-C'})}).catch(()=>{});
    // #endregion
    await sendMessage(msg);
    await updateIdempotencyStatus(key, 0, "done");
    return empty;
  }

  const listings = parseResult.listings;
  if (listings.length === 0) {
    console.log("No listings found in email.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      const snippet = llmContent.slice(0, 300);
      await sendMessage(
        `📭 No listings found in email.\n\nContent preview:\n${snippet}…`,
      );
    }
    await updateIdempotencyStatus(key, 0, "empty");
    return empty;
  }

  // Validate and clean
  const validated = await validateAndCleanListings(listings);
  if (validated.length === 0) {
    console.log("All listings failed validation.");
    await updateIdempotencyStatus(key, 0, "empty");
    return empty;
  }

  // Dedup and store
  const { newIds, updatedIds, changes } = await deduplicateAndStore(
    validated,
    rawEmail,
  );
  const totalProcessed = newIds.length + updatedIds.length;

  if (totalProcessed === 0) {
    console.log("All listings were unchanged duplicates.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      await sendMessage(
        `📭 ${validated.length} listing(s) found but all were unchanged duplicates.`,
      );
    }
    await updateIdempotencyStatus(key, 0, "done");
    return empty;
  }

  await updateIdempotencyStatus(key, totalProcessed, "done");
  return { newIds, updatedIds, changes };
}

async function updateIdempotencyStatus(
  key: string,
  listingCount: number,
  status: "done" | "empty",
): Promise<void> {
  await getSupabaseAdmin()
    .from("ingest_idempotency")
    .update({ listing_count: listingCount, status })
    .eq("idempotency_key", key);
}
