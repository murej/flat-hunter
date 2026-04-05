import {
  sendMessage,
  sendMarkdown,
  sendWithButtons,
  answerCallbackQuery,
  deleteMessage,
  startTypingIndicator,
} from "@/lib/telegram";
import {
  logConversation,
  getPreferences,
  deletePreferences,
  getConversationHistory,
  getSessionMode,
  setSessionMode,
  clearSessionMode,
  storeMessageListing,
} from "@/lib/supabase";
import {
  getScorecard,
  getWhyContext,
  getFormattedPreferences,
  getFormattedSavedList,
} from "@/lib/tools/listing";
import { runPreferenceAgent } from "@/lib/agents/preference";
import { runAgent } from "@/lib/core/agent";
import {
  getWhyExplanationModel,
  getIngestNotificationModel,
} from "@/lib/config/agent-models";
import { WHY_EXPLANATION_SYSTEM } from "./prompts";
import { INGEST_NOTIFICATION_SYSTEM } from "@/lib/agents/ingest/prompts";
import { TELEMETRY_TAG_WHY, SUB_AGENT_MAX_STEPS } from "./config";
import { conversationAgent } from "./index";
import type { Preferences } from "@/types";

function prefsContext(prefs: Preferences | null): string {
  if (!prefs) return "\n\n[No preferences saved yet]";
  return `\n\n[Current saved preferences: ${JSON.stringify(prefs)}]`;
}

export async function handleTelegramUpdate(input: {
  text: string;
  messageId: number;
  callbackQueryId?: string;
}): Promise<void> {
  const { text, messageId, callbackQueryId } = input;

  if (!text) return;

  // Acknowledge callback query immediately (non-critical, don't crash on failure)
  if (callbackQueryId) {
    try {
      await answerCallbackQuery(callbackQueryId);
    } catch {}
  }

  const typing = startTypingIndicator();

  try {
    // /stop — stop any active flow
    if (text === "/stop") {
      await clearSessionMode();
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "stop",
      });
      const stopResult = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt:
          "The user just stopped the current flow. Acknowledge briefly and ask what else they need.",
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: "stop_notification",
      });
      await sendMarkdown(stopResult.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: stopResult.message,
        intent: "stop",
      });
      return;
    }

    // /restart — reset preferences with confirmation
    if (text === "/restart") {
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "restart",
      });
      const confirm = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt:
          'The user typed /restart to reset their property search preferences and start fresh. Write the confirmation question for Telegram. They will see two buttons: "Yes, reset" and "No, keep". Ask if they are sure and warn that saved preferences will be deleted. One short paragraph.',
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: "restart_confirm",
      });
      await sendWithButtons(confirm.message, [
        [
          { text: "Yes, reset", callback_data: "restart_confirm" },
          { text: "No, keep", callback_data: "restart_deny" },
        ],
      ]);
      return;
    }

    // restart_confirm / restart_deny callbacks
    if (text === "restart_confirm") {
      await deletePreferences();
      await clearSessionMode();
      await deleteMessage(messageId);
      await setSessionMode("preference");
      const result = await runPreferenceAgent(
        "The user just reset. Begin collecting their property search preferences.\n\n[No preferences saved yet]",
      );
      await sendMarkdown(result.message);
      return;
    }
    if (text === "restart_deny") {
      await deleteMessage(messageId);
      const denyAck = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt:
          "The user chose not to reset their property search preferences. Acknowledge briefly and positively.",
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: "restart_deny",
      });
      await sendMarkdown(denyAck.message);
      return;
    }

    // /preferences — show current preferences
    if (text === "/preferences") {
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "preferences",
      });
      const msg = await getFormattedPreferences();
      await sendMarkdown(msg);
      return;
    }

    // /liked — show liked (saved) properties
    if (text === "/liked") {
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "liked",
      });
      const msg = await getFormattedSavedList();
      await sendMarkdown(msg);
      return;
    }

    // Check preference mode (skip for action callbacks)
    const sessionMode = await getSessionMode();
    if (sessionMode === "preference" && !/^(why|scorecard):/.test(text)) {
      const [, prefsBefore, history] = await Promise.all([
        logConversation({
          telegram_message_id: messageId,
          direction: "inbound",
          message: text,
          intent: "preference_reply",
        }),
        getPreferences(),
        getConversationHistory(),
      ]);
      const result = await runPreferenceAgent(
        text + prefsContext(prefsBefore),
        history,
      );
      const prefsAfter = await getPreferences();

      const prefsSaved =
        (!prefsBefore && prefsAfter) ||
        (prefsBefore &&
          prefsAfter &&
          prefsAfter.updated_at !== prefsBefore.updated_at);

      if (prefsSaved) {
        await clearSessionMode();
      } else {
        // Refresh timeout
        await setSessionMode("preference");
      }

      await sendMarkdown(result.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: result.message,
        intent: "preference_reply",
      });
      return;
    }

    // Route: why:{id}
    const whyMatch = text.match(/^why:(.+)$/);
    if (whyMatch) {
      const id = whyMatch[1];
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        listing_id: id,
        intent: "why",
      });

      const context = await getWhyContext(id);
      if (!context) {
        await sendMessage("Could not find evaluation data for this listing.");
        return;
      }

      const explanation = await runAgent({
        systemPrompt: WHY_EXPLANATION_SYSTEM,
        prompt: `Explain these evaluation scores:\n${JSON.stringify(context, null, 2)}`,
        model: getWhyExplanationModel(),
        maxSteps: SUB_AGENT_MAX_STEPS,
        telemetryTag: TELEMETRY_TAG_WHY,
      });
      await sendMarkdown(explanation.message, { reply_to_message_id: messageId });
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: explanation.message,
        listing_id: id,
        intent: "why_explanation",
      });
      return;
    }

    // Route: scorecard:{id}
    const scorecardMatch = text.match(/^scorecard:(.+)$/);
    if (scorecardMatch) {
      const id = scorecardMatch[1];
      const scorecard = await getScorecard(id);
      if (scorecard) {
        const msgId = await sendWithButtons(
          scorecard.text,
          scorecard.buttons,
          "Markdown",
        );
        await storeMessageListing(msgId, id);
      } else {
        await sendMessage("Listing not found.");
      }
      return;
    }

    // Route: update preferences / update:{category} (case-insensitive; Telegram button is lowercase but users often Title Case)
    const trimmedInbound = text.trim();
    const lowerInbound = trimmedInbound.toLowerCase();
    const isUpdatePreferencesPhrase = lowerInbound === "update preferences";
    const isUpdateCategoryCallback =
      lowerInbound.startsWith("update:") && trimmedInbound.includes(":");
    if (isUpdatePreferencesPhrase || isUpdateCategoryCallback) {
      const category = isUpdateCategoryCallback
        ? trimmedInbound.slice(trimmedInbound.indexOf(":") + 1) || undefined
        : undefined;
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "update_preferences",
      });
      await setSessionMode("preference");

      const prefs = await getPreferences();
      const prompt = category
        ? `The user wants to update their ${category} preferences. Ask what they'd like to change.`
        : "The user wants to update their preferences. Ask what they'd like to change.";
      const result = await runPreferenceAgent(prompt + prefsContext(prefs));
      await sendMarkdown(result.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: result.message,
        intent: "update_preferences",
      });
      return;
    }

    // Route: bare greetings — respond without invoking the agent
    const GREETING_WORDS =
      /^(h(ello|i|ey|owdy|iya)|yo|sup|morning|evening|afternoon|what'?s up|alright)[!?.]*$/i;
    if (GREETING_WORDS.test(text.trim())) {
      await logConversation({
        telegram_message_id: messageId,
        direction: "inbound",
        message: text,
        intent: "greeting",
      });
      const greetResult = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt: `The user just said "${text}". Greet them back briefly and ask what they need.`,
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: "greeting",
      });
      await sendMarkdown(greetResult.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: greetResult.message,
        intent: "greeting",
      });
      return;
    }

    // Default: conversation agent
    await conversationAgent(text, messageId);
  } finally {
    typing.stop();
  }
}
