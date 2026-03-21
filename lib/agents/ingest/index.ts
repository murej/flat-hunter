import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseVerificationEmail,
  parseEmailHtml,
  deduplicateAndStore,
  buildLlmContextFromRaw,
  repairListingsFromEmailBody,
} from "./tools";
import { envBool } from "@/lib/utils/env-utils";
import {
  notifyVerificationEmailTelegram,
  notifyNoListingsParsedVerbose,
  notifyAllDuplicatesVerbose,
  notifyDuplicatesSkippedWhileEvaluating,
} from "./notify-telegram";

export async function ingestAgent(
  content: string,
  isRaw: boolean,
): Promise<{ newIds: string[] }> {
  // Build LLM-friendly content
  const llmContent = isRaw
    ? await buildLlmContextFromRaw(content)
    : content;

  // Idempotency check
  const key = computeIdempotencyKey(llmContent);
  const claimed = await claimIdempotencyKey(key);
  if (!claimed) {
    console.log("Duplicate email, skipping.");
    return { newIds: [] };
  }

  // Check if verification email
  const verification = await parseVerificationEmail(llmContent);
  if (verification.isVerification) {
    await notifyVerificationEmailTelegram({
      verificationUrl: verification.verificationUrl,
      verificationCode: verification.verificationCode,
    });
    return { newIds: [] };
  }

  // Parse listings
  const parsed = await parseEmailHtml(llmContent);
  const listings = repairListingsFromEmailBody(parsed, llmContent);
  if (listings.length === 0) {
    console.log("No listings found in email.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      const snippet = llmContent.slice(0, 300);
      await notifyNoListingsParsedVerbose(snippet);
    }
    return { newIds: [] };
  }

  // Dedup and store
  const { newIds, unchangedDuplicateCount } = await deduplicateAndStore(listings);
  if (newIds.length === 0) {
    console.log("All listings were duplicates or unchanged.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      await notifyAllDuplicatesVerbose({
        parsedCount: listings.length,
        unchangedDuplicateCount,
      });
    }
    return { newIds: [] };
  }

  if (envBool("TELEGRAM_VERBOSE_MODE") && unchangedDuplicateCount > 0) {
    await notifyDuplicatesSkippedWhileEvaluating({
      unchangedDuplicateCount,
      newOrUpdatedCount: newIds.length,
    });
  }

  return { newIds };
}
