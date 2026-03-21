import { runAgent } from "@/lib/core/agent";
import { getIngestNotificationModel } from "@/lib/config/agent-models";
import { INGEST_NOTIFICATION_SYSTEM } from "@/lib/agents/ingest/prompts";
import { sendMarkdown } from "@/lib/telegram";
import { reportError } from "@/lib/core/reporting";

export async function notifyVerificationEmailTelegram(payload: {
  verificationUrl?: string;
  verificationCode?: string;
}): Promise<void> {
  const facts = [
    payload.verificationUrl && `Verification URL: ${payload.verificationUrl}`,
    payload.verificationCode && `Verification code: ${payload.verificationCode}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await runAgent({
      systemPrompt: INGEST_NOTIFICATION_SYSTEM,
      prompt: `A portal sent a verification or confirmation email (not a property alert). Extracted facts:\n${facts || "No URL or code was extracted."}\nWrite one short Telegram message so the user can complete verification.`,
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: "ingest_verification_notify",
    });
    await sendMarkdown(result.message);
  } catch (err) {
    await reportError(err, {
      source: "ingest/notifyVerificationEmailTelegram",
      telemetryTag: "ingest_verification_notify",
    });
  }
}

export async function notifyNoListingsParsedVerbose(snippet: string): Promise<void> {
  try {
    const result = await runAgent({
      systemPrompt: INGEST_NOTIFICATION_SYSTEM,
      prompt: `Verbose ingest diagnostic: no property listings were parsed from an alert email. Content preview (first 300 characters):\n${snippet}\nSummarize in one short Telegram message for debugging.`,
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: "ingest_no_listings_verbose",
    });
    await sendMarkdown(result.message);
  } catch (err) {
    await reportError(err, {
      source: "ingest/notifyNoListingsParsedVerbose",
      telemetryTag: "ingest_no_listings_verbose",
    });
  }
}

export async function notifyAllDuplicatesVerbose(payload: {
  parsedCount: number;
  unchangedDuplicateCount: number;
}): Promise<void> {
  try {
    const result = await runAgent({
      systemPrompt: INGEST_NOTIFICATION_SYSTEM,
      prompt: `Verbose ingest diagnostic: ${payload.parsedCount} listing(s) were parsed from the email but none were new or updated (${payload.unchangedDuplicateCount} unchanged duplicate(s)). One short Telegram message.`,
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: "ingest_all_duplicates_verbose",
    });
    await sendMarkdown(result.message);
  } catch (err) {
    await reportError(err, {
      source: "ingest/notifyAllDuplicatesVerbose",
      telemetryTag: "ingest_all_duplicates_verbose",
    });
  }
}

export async function notifyDuplicatesSkippedWhileEvaluating(payload: {
  unchangedDuplicateCount: number;
  newOrUpdatedCount: number;
}): Promise<void> {
  try {
    const result = await runAgent({
      systemPrompt: INGEST_NOTIFICATION_SYSTEM,
      prompt: `Verbose ingest: ${payload.unchangedDuplicateCount} duplicate listing(s) skipped (data unchanged). Evaluating ${payload.newOrUpdatedCount} new or updated. One short Telegram message.`,
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: "ingest_dup_skipped_evaluating",
    });
    await sendMarkdown(result.message);
  } catch (err) {
    await reportError(err, {
      source: "ingest/notifyDuplicatesSkippedWhileEvaluating",
      telemetryTag: "ingest_dup_skipped_evaluating",
    });
  }
}
