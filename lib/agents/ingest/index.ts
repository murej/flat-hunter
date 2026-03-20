import {
  computeIdempotencyKey,
  claimIdempotencyKey,
  parseVerificationEmail,
  parseEmailHtml,
  deduplicateAndStore,
} from "./tools";
import { buildLlmContextFromParts, buildLlmContextFromRaw } from "./email-llm-input";
import { sendMessage } from "@/lib/telegram";

export async function ingestAgent(
  content: string,
  isRaw: boolean,
): Promise<{ newIds: number[] }> {
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
  const listings = await parseEmailHtml(llmContent);
  if (listings.length === 0) {
    console.log("No listings found in email.");
    return { newIds: [] };
  }

  // Dedup and store
  const newIds = await deduplicateAndStore(listings);
  if (newIds.length === 0) {
    console.log("All listings were duplicates.");
    return { newIds: [] };
  }

  return { newIds };
}
