import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseVerificationEmail,
  parseEmailHtml,
  deduplicateAndStore,
  buildLlmContextFromRaw,
  repairListingsFromEmailBody,
} from "./tools";
import { sendMessage } from "@/lib/telegram";
import { envBool } from "@/lib/utils/env-utils";

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
    const msg = verification.verificationUrl
      ? `🔐 Verification email received.\nURL: ${verification.verificationUrl}`
      : verification.verificationCode
        ? `🔐 Verification code: ${verification.verificationCode}`
        : "🔐 Verification email received (no URL/code extracted).";
    await sendMessage(msg);
    return { newIds: [] };
  }

  // Parse listings
  const parsed = await parseEmailHtml(llmContent);
  const listings = repairListingsFromEmailBody(parsed, llmContent);
  if (listings.length === 0) {
    console.log("No listings found in email.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      const snippet = llmContent.slice(0, 300);
      await sendMessage(`📭 No listings found in email.\n\nContent preview:\n${snippet}…`);
    }
    return { newIds: [] };
  }

  // Dedup and store
  const { newIds, unchangedDuplicateCount } = await deduplicateAndStore(listings);
  if (newIds.length === 0) {
    console.log("All listings were duplicates or unchanged.");
    if (envBool("TELEGRAM_VERBOSE_MODE")) {
      await sendMessage(
        `📭 ${listings.length} listing(s) found; none new or updated (${unchangedDuplicateCount} unchanged duplicate(s)).`,
      );
    }
    return { newIds: [] };
  }

  if (envBool("TELEGRAM_VERBOSE_MODE") && unchangedDuplicateCount > 0) {
    await sendMessage(
      `ℹ️ ${unchangedDuplicateCount} duplicate listing(s) skipped (data unchanged). Evaluating ${newIds.length} new or updated.`,
    );
  }

  return { newIds };
}
