import { sendMessage, sendMarkdown, sendWithButtons, answerCallbackQuery } from "@/lib/telegram";
import { logConversation, getPreferences, getConversationHistory, getSessionMode, setSessionMode, clearSessionMode } from "@/lib/supabase";
import { saveListing, skipListing, getScorecard, getWhyContext } from "@/lib/tools/listing";
import { runPreferenceAgent } from "@/lib/agents/preference";
import { runAgent } from "@/lib/core/agent";
import { getWhyExplanationModel } from "@/lib/config/agent-models";
import { WHY_EXPLANATION_SYSTEM } from "./prompts";
import { TELEMETRY_TAG_WHY, SUB_AGENT_MAX_STEPS } from "./config";
import { conversationAgent } from "./index";

export async function handleTelegramUpdate(input: {
  text: string;
  messageId: number;
  callbackQueryId?: string;
}): Promise<void> {
  const { text, messageId, callbackQueryId } = input;

  if (!text) return;

  // Acknowledge callback query immediately
  if (callbackQueryId) {
    await answerCallbackQuery(callbackQueryId);
  }

  // /cancel — exit preference mode
  if (text === "/cancel") {
    await clearSessionMode();
    await sendMessage("Cancelled. Type anything to chat.");
    return;
  }

  // Check preference mode (skip for action callbacks)
  const sessionMode = await getSessionMode();
  if (
    sessionMode === "preference" &&
    !/^(save|skip|unsave|why|scorecard):/.test(text) &&
    text !== "/start"
  ) {
    await logConversation({
      telegram_message_id: messageId,
      direction: "inbound",
      message: text,
      intent: "preference_reply",
    });

    const prefsBefore = await getPreferences();
    const history = await getConversationHistory();
    const result = await runPreferenceAgent(text, history);
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

  // Route: /start
  if (text === "/start") {
    await logConversation({ telegram_message_id: messageId, direction: "inbound", message: text, intent: "start" });
    const prefs = await getPreferences();
    if (prefs) {
      await sendMessage("Welcome back! Your preferences are already set up. Type anything to chat, or say 'update preferences' to change them.");
    } else {
      await setSessionMode("preference");
      const result = await runPreferenceAgent("The user just started. Begin collecting their property search preferences.");
      await sendMarkdown(result.message);
    }
    await logConversation({ telegram_message_id: messageId, direction: "outbound", message: "Welcome", intent: "start" });
    return;
  }

  // Route: save:/skip:/unsave: callbacks
  const saveMatch = text.match(/^(save|skip|unsave):(\d+)$/);
  if (saveMatch) {
    const [, action, idStr] = saveMatch;
    const id = parseInt(idStr, 10);
    await logConversation({ telegram_message_id: messageId, direction: "inbound", message: text, listing_id: id, intent: action });

    if (action === "save") {
      await saveListing(id);
      await sendMessage("💾 Saved!");
    } else if (action === "unsave") {
      // Reset to evaluated
      const { updateListingStatus } = await import("@/lib/supabase");
      await updateListingStatus(id, "evaluated");
      await sendMessage("📌 Unsaved. Status reset to evaluated.");
    } else {
      await skipListing(id);
      await sendMessage("⏭ Skipped.");
    }
    return;
  }

  // Route: why:{id}
  const whyMatch = text.match(/^why:(\d+)$/);
  if (whyMatch) {
    const id = parseInt(whyMatch[1], 10);
    await logConversation({ telegram_message_id: messageId, direction: "inbound", message: text, listing_id: id, intent: "why" });

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
    await sendMarkdown(explanation.message);
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
  const scorecardMatch = text.match(/^scorecard:(\d+)$/);
  if (scorecardMatch) {
    const id = parseInt(scorecardMatch[1], 10);
    const scorecard = await getScorecard(id);
    if (scorecard) {
      await sendWithButtons(scorecard.text, scorecard.buttons, "Markdown");
    } else {
      await sendMessage("Listing not found.");
    }
    return;
  }

  // Route: update preferences / update:{category}
  if (text === "update preferences" || text.startsWith("update:")) {
    const category = text.startsWith("update:") ? text.split(":")[1] : undefined;
    await logConversation({ telegram_message_id: messageId, direction: "inbound", message: text, intent: "update_preferences" });
    await setSessionMode("preference");

    const prompt = category
      ? `The user wants to update their ${category} preferences. Read current preferences first, then ask what they'd like to change.`
      : "The user wants to update their preferences. Read current preferences and ask what they'd like to change.";
    const result = await runPreferenceAgent(prompt);
    await sendMarkdown(result.message);
    await logConversation({ telegram_message_id: messageId, direction: "outbound", message: result.message, intent: "update_preferences" });
    return;
  }

  // Default: conversation agent
  await conversationAgent(text, messageId);
}
