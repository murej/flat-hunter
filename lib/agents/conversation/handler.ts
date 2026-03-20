import type { TelegramMessage } from "@/types";
import {
  answerCallbackQuery,
  sendMessage,
  sendWithButtons,
  sendWithReplyKeyboard,
} from "@/lib/telegram";
import { getPreferences } from "@/lib/supabase";
import { logConversation } from "@/lib/supabase";
import { collectPreferences } from "@/lib/agents/preference";
import {
  saveListing,
  skipListing,
  getScorecard,
  getWhyContext,
  UPDATE_PREFERENCES_BUTTONS,
} from "@/lib/tools/listing";
import { WHY_EXPLANATION_SYSTEM } from "@/lib/agents/conversation/prompts";
import { conversationAgent } from "@/lib/agents/conversation";
import { getWhyExplanationModel } from "@/lib/config/agent-models";
import { runAgent } from "@/lib/core/agent";

export async function handleTelegramUpdate(
  parsed: TelegramMessage,
): Promise<void> {
  const { text, messageId, callbackQueryId } = parsed;

  const answerCallback = async () => {
    if (callbackQueryId) await answerCallbackQuery(callbackQueryId);
  };

  if (text === "/start") {
    await answerCallback();
    const preferences = await getPreferences();
    if (preferences) {
      await sendWithReplyKeyboard(
        "Welcome back. Use the buttons below or type a message.",
        [
          [{ text: "Saved" }, { text: "Preferences" }],
          [{ text: "New matches" }],
        ],
      );
    } else {
      const result = await collectPreferences(
        "I'd like to set up my property search preferences.",
        messageId,
      );
      if (result.message) await sendMessage(result.message);
    }
    return;
  }

  if (text.startsWith("unsave:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await skipListing(listingId);
      await sendMessage("Removed from saved properties.");
    }
    return;
  }

  if (text.startsWith("save:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await saveListing(listingId);
      await sendMessage("Saved! ⭐️ I'll keep that one for you.");
    }
    return;
  }

  if (text.startsWith("skip:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await skipListing(listingId);
      await sendMessage("Done — property dismissed. 👋");
    }
    return;
  }

  if (text.startsWith("why:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      const result = await getWhyContext(listingId);
      if (result.ok) {
        const explanation = await runAgent({
          prompt: result.context,
          systemPrompt: WHY_EXPLANATION_SYSTEM,
          model: getWhyExplanationModel(),
          telemetryTag: "why_explanation",
        });
        const message = "message" in explanation ? explanation.message : "";
        if (message) {
          await logConversation({
            direction: "outbound",
            message,
            listing_id: listingId,
            intent: "why",
          });
          await sendMessage(message);
        }
      }
    }
    return;
  }

  if (text.startsWith("scorecard:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      const result = await getScorecard(listingId);
      if (result.ok) {
        await logConversation({
          direction: "outbound",
          message: result.scorecardText,
          listing_id: result.listingId,
          intent: null,
        });
        await sendWithButtons(result.scorecardText, result.buttons);
      } else {
        await sendMessage(result.message);
      }
    }
    return;
  }

  if (text === "update preferences") {
    await answerCallback();
    const updatePrompt = "What would you like to update?";
    await logConversation({
      direction: "outbound",
      message: updatePrompt,
      intent: "preferences",
    });
    await sendWithButtons(updatePrompt, UPDATE_PREFERENCES_BUTTONS);
    return;
  }

  if (text.startsWith("update:")) {
    await answerCallback();
    const part = text.replace(/^update:/, "");
    const messageMap: Record<string, string> = {
      areas: "I want to update my areas",
      budget: "I want to update my budget and deposit",
      bedrooms: "I want to update my minimum bedrooms",
      commute: "I want to update my commute settings",
      must_haves: "I want to update my must-haves",
      deal_breakers: "I want to update my deal-breakers",
      other: "I want to update my preferences",
    };
    const naturalMessage =
      messageMap[part] ?? "I want to update my preferences";
    const dedupId = callbackQueryId ?? messageId;
    const result = await collectPreferences(naturalMessage, dedupId);
    if (result.message) await sendMessage(result.message);
    return;
  }

  await answerCallback();
  await conversationAgent(text, messageId);
}
