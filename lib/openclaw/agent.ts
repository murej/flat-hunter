import Anthropic from "@anthropic-ai/sdk";
import type { TelegramMessage } from "@/types";
import {
  answerCallbackQuery,
  sendMessage,
  sendWithButtons,
  sendWithReplyKeyboard,
} from "./telegram";
import type { AgentButton } from "./telegram";
import { getPreferences } from "@/lib/supabase";
import { logConversation } from "@/lib/supabase";
import { collectPreferences } from "@/lib/tools/preference";
import {
  saveListing,
  skipListing,
  getScorecard,
  getWhyContext,
  UPDATE_PREFERENCES_BUTTONS,
} from "./tools";
import { WHY_EXPLANATION_SYSTEM } from "@/lib/prompts";
import { conversationAgent } from "./conversation";

export type AgentMetadata = {
  listingId?: string | null;
  intent?: string | null;
};

export type { AgentButton };

export type DirectToolResult = {
  type: "direct";
  message: string;
  buttons?: AgentButton[][];
  metadata?: AgentMetadata;
};

export type DataToolResult = {
  type: "data";
  data: string;
  toolName: string;
};

export type ToolResult = DirectToolResult | DataToolResult;

export type GenericAgentInput = {
  prompt: string;
  systemPrompt: string;
  tools?: Anthropic.Tool[];
  messages?: Anthropic.MessageParam[];
  executeTool?: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
};

export type MessageOutput = {
  message: string;
  buttons?: AgentButton[][];
  metadata?: AgentMetadata;
};

export type DataOutput = {
  type: "data";
  data: string;
  toolName: string;
};

export type GenericAgentOutput = MessageOutput | DataOutput;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runGenericAgent(
  input: GenericAgentInput,
): Promise<GenericAgentOutput> {
  const { prompt, systemPrompt, tools, messages: history, executeTool } = input;

  const messages: Anthropic.MessageParam[] = history
    ? [...history, { role: "user" as const, content: prompt }]
    : [{ role: "user" as const, content: prompt }];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    ...(tools && tools.length > 0 ? { tools } : {}),
    messages,
  });

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );

  if (!toolBlock || !executeTool) {
    const message = textBlock?.text ?? "";
    return { message };
  }

  const toolInput = toolBlock.input as Record<string, unknown>;
  const result = await executeTool(toolBlock.name, toolInput);

  if (result.type === "data") {
    return {
      type: "data",
      data: result.data,
      toolName: result.toolName,
    };
  }

  return {
    message: result.message,
    buttons: result.buttons,
    metadata: result.metadata,
  };
}

export async function handleTelegramUpdate(
  parsed: TelegramMessage,
): Promise<void> {
  const { text, messageId, callbackQueryId } = parsed;

  const answerCallback = async () => {
    if (callbackQueryId) await answerCallbackQuery(callbackQueryId);
  };

  // Fast path: /start
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

  // Fast path: unsave:
  if (text.startsWith("unsave:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await skipListing(listingId);
      await sendMessage("Removed from saved properties.");
    }
    return;
  }

  // Fast path: save:
  if (text.startsWith("save:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await saveListing(listingId);
      await sendMessage("Saved! ⭐️ I'll keep that one for you.");
    }
    return;
  }

  // Fast path: skip:
  if (text.startsWith("skip:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      await skipListing(listingId);
      await sendMessage("Done — property dismissed. 👋");
    }
    return;
  }

  // Fast path: why:
  if (text.startsWith("why:")) {
    const listingId = text.split(":")[1];
    if (listingId) {
      await answerCallback();
      const result = await getWhyContext(listingId);
      if (result.ok) {
        const explanation = await runGenericAgent({
          prompt: result.context,
          systemPrompt: WHY_EXPLANATION_SYSTEM,
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

  // Fast path: scorecard:
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

  // Fast path: update preferences
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

  // Fast path: update:*
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

  // Fallback: free text -> conversation agent
  await answerCallback();
  await conversationAgent(text, messageId);
}
