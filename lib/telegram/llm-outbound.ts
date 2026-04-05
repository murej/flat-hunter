import { runAgent } from "@/lib/core/agent";
import { getIngestNotificationModel } from "@/lib/config/agent-models";
import {
  API_USER_ERROR_SYSTEM,
  INGEST_NOTIFICATION_SYSTEM,
} from "@/lib/agents/ingest/prompts";
import { sendMarkdown, sendPlainText } from "@/lib/telegram";

export async function sendReactionListingSavedAck(
  listingId: string,
  replyToMessageId?: number,
): Promise<void> {
  const result = await runAgent({
    systemPrompt: INGEST_NOTIFICATION_SYSTEM,
    prompt: `The user saved a property listing to their shortlist (Telegram like/reaction). Listing id: ${listingId}. Send one short cheerful confirmation. You do not need to repeat the id unless it feels natural.`,
    model: getIngestNotificationModel(),
    maxSteps: 1,
    telemetryTag: "reaction_save_ack",
  });
  await sendMarkdown(result.message, { reply_to_message_id: replyToMessageId });
}

export async function sendTelegramRouteCatchUserMessage(): Promise<void> {
  try {
    const result = await runAgent({
      systemPrompt: API_USER_ERROR_SYSTEM,
      prompt:
        "An unexpected error occurred while handling a Telegram webhook request. Produce the user-facing message now.",
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: "api_telegram_catch",
    });
    try {
      await sendMarkdown(result.message);
    } catch {
      await sendPlainText(result.message.slice(0, 4096));
    }
  } catch {
    await sendPlainText("Something went wrong.");
  }
}
