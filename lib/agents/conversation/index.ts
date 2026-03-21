import { runAgent } from "@/lib/core/agent";
import { getConversationModel, getWhyExplanationModel } from "@/lib/config/agent-models";
import { CONVERSATION_MAX_STEPS } from "@/lib/config/conversation-llm";
import { TELEMETRY_TAG, TELEMETRY_TAG_WHY, TELEMETRY_TAG_COMPARISON, SUB_AGENT_MAX_STEPS } from "./config";
import {
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
} from "./prompts";
import { buildConversationTools } from "./tools";
import {
  getConversationHistory,
  getActiveListingId,
  logConversation,
  getPreferences,
  setSessionMode,
} from "@/lib/supabase";
import { runPreferenceAgent } from "@/lib/agents/preference";
import { sendMessage, sendMarkdown, sendWithButtons } from "@/lib/telegram";
import type { TelegramPayload } from "@/types";

export async function conversationAgent(
  text: string,
  messageId: number,
  listingId?: number,
): Promise<void> {
  // Fire all pre-LLM queries in parallel
  const [, prefs, activeId, history] = await Promise.all([
    logConversation({
      telegram_message_id: messageId,
      direction: "inbound",
      message: text,
      listing_id: listingId ?? null,
      intent: null,
    }),
    getPreferences(),
    listingId ? Promise.resolve(listingId) : getActiveListingId(),
    getConversationHistory(8, ["preference_reply", "update_preferences"]),
  ]);

  if (!prefs) {
    await setSessionMode("preference");
    const result = await runPreferenceAgent(
      "The user just started. Begin collecting their property search preferences.\n\n[No preferences saved yet]",
    );
    await sendMarkdown(result.message);
    await logConversation({
      telegram_message_id: messageId,
      direction: "outbound",
      message: result.message,
      intent: "preference_reply",
    });
    return;
  }

  // Build tools
  const { tools, getCaptured } = buildConversationTools(activeId);

  // Add active listing context to prompt
  const contextNote = activeId
    ? `\n[Active listing context: ID ${activeId}]`
    : "";

  // Run agent
  const result = await runAgent({
    systemPrompt: CONVERSATION_AGENT_SYSTEM,
    messages: [
      ...history,
      { role: "user" as const, content: text + contextNote },
    ],
    tools,
    model: getConversationModel(),
    maxSteps: CONVERSATION_MAX_STEPS,
    telemetryTag: TELEMETRY_TAG,
  });

  const captured = getCaptured();

  // Handle DataToolResult — chain to sub-agent
  if (captured?.type === "data") {
    const dataResult = captured;

    if (dataResult.toolName === "get_property_evaluation") {
      const explanation = await runAgent({
        systemPrompt: WHY_EXPLANATION_SYSTEM,
        prompt: `Explain these evaluation scores:\n${JSON.stringify(dataResult.data, null, 2)}`,
        model: getWhyExplanationModel(),
        maxSteps: SUB_AGENT_MAX_STEPS,
        telemetryTag: TELEMETRY_TAG_WHY,
      });
      await sendMarkdown(explanation.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: explanation.message,
        listing_id: activeId ?? null,
        intent: "why_explanation",
      });
      return;
    }

    if (dataResult.toolName === "get_comparison_data") {
      const comparison = await runAgent({
        systemPrompt: COMPARISON_SYSTEM,
        prompt: `Compare these properties:\n${JSON.stringify(dataResult.data, null, 2)}`,
        model: getWhyExplanationModel(),
        maxSteps: SUB_AGENT_MAX_STEPS,
        telemetryTag: TELEMETRY_TAG_COMPARISON,
      });
      await sendMarkdown(comparison.message);
      await logConversation({
        telegram_message_id: messageId,
        direction: "outbound",
        message: comparison.message,
        intent: "comparison",
      });
      return;
    }
  }

  // Handle DirectToolResult
  if (captured?.type === "direct") {
    const payload = captured.payload as TelegramPayload | undefined;
    if (payload?.buttons) {
      await sendWithButtons(
        captured.message,
        payload.buttons,
        payload.parse_mode,
      );
    } else {
      await sendMessage(captured.message, {
        parse_mode: payload?.parse_mode,
      });
    }
    await logConversation({
      telegram_message_id: messageId,
      direction: "outbound",
      message: captured.message,
      listing_id: activeId ?? null,
    });
    return;
  }

  // Default: send agent text response
  await sendMarkdown(result.message);
  await logConversation({
    telegram_message_id: messageId,
    direction: "outbound",
    message: result.message,
    listing_id: activeId ?? null,
  });
}
