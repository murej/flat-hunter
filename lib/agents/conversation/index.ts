import type { Anthropic } from "@anthropic-ai/sdk";
import {
  getPreferences,
  logConversation,
  getActiveListingId,
  getConversationHistory,
} from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
import { collectPreferences } from "@/lib/agents/preference";
import {
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
} from "./prompts";
import {
  getConversationExplanationModel,
  getConversationModel,
} from "@/lib/config/agent-models";
import { getConversationMaxToolIterations } from "@/lib/config/conversation-llm";
import { runAgent } from "@/lib/core/agent";
import {
  buildConversationTools,
  createConversationExecuteTool,
} from "./tools";

const ANTHROPIC_OUT_OF_CREDITS_MSG =
  "No more credits, feed Claude. I don't know what to say 😢";

const ANTHROPIC_RATE_LIMIT_MSG =
  "Too much yum yum, try again in a minute.";

function isAnthropicOutOfCredits(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const status = err.status as number | undefined;
  const message = [err.message, err.error, JSON.stringify(err)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const isQuota = message.includes("insufficient") && message.includes("quota");
  const isCreditBalance = message.includes("credit balance is too low");
  return status === 400 && (isQuota || isCreditBalance);
}

function isAnthropicRateLimited(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const status = err.status as number | undefined;
  const message = [err.message, err.error, JSON.stringify(err)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isRateLimitStatus = status === 429 || status === 529;

  const nestedError = (err.error as Record<string, unknown> | undefined) ?? {};
  const nestedType = String(nestedError.type ?? "").toLowerCase();

  const isRateLimitType =
    nestedType === "rate_limit_error" || nestedType === "overloaded_error";

  const isRateLimitMessage =
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("overloaded");

  return isRateLimitStatus || isRateLimitType || isRateLimitMessage;
}

const EXPLANATION_AGENTS: Record<
  string,
  { systemPrompt: string; intent: string }
> = {
  get_property_evaluation: {
    systemPrompt: WHY_EXPLANATION_SYSTEM,
    intent: "why",
  },
  get_comparison_data: { systemPrompt: COMPARISON_SYSTEM, intent: "compare" },
};

export async function conversationAgent(
  text: string,
  messageId: string,
): Promise<void> {
  const { inserted } = await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: text,
  });
  if (!inserted) return;

  try {
    const preferences = await getPreferences();
    if (!preferences) {
      const result = await collectPreferences(text, messageId);
      if (result.message) await sendMessage(result.message);
      return;
    }

    if (isShowPreferencesIntent(text)) {
      const executeTool = createConversationExecuteTool({
        activeListingId: null,
        preferences,
        userMessage: text,
        messageId,
      });
      const result = await executeTool("show_preferences", {});
      if (result.type === "direct") {
        await logConversation({
          direction: "outbound",
          message: result.message,
          intent: "preferences",
        });
        if (result.buttons && result.buttons.length > 0) {
          await sendWithButtons(result.message, result.buttons);
        } else {
          await sendMessage(result.message);
        }
      }
      return;
    }

    if (isShowSavedIntent(text)) {
      const executeTool = createConversationExecuteTool({
        activeListingId: null,
        preferences,
        userMessage: text,
        messageId,
      });
      const result = await executeTool("show_saved_properties", {});
      if (result.type === "direct") {
        await logConversation({
          direction: "outbound",
          message: result.message,
          intent: "other",
        });
        if (result.buttons && result.buttons.length > 0) {
          await sendWithButtons(result.message, result.buttons, {
            disable_web_page_preview: true,
          });
        } else {
          await sendMessage(result.message, {
            disable_web_page_preview: true,
          });
        }
      }
      return;
    }

    const history = await getConversationHistory(8);
    const listingIdFromText = extractListingId(text);
    const activeListingId =
      listingIdFromText ?? (await getActiveListingId(10));

    if (!listingIdFromText && !activeListingId) {
      const msg =
        "Which property do you mean? Reply with the title, address, or tap a scorecard button so I can be sure I'm talking about the right one.";
      await sendMessage(msg);
      await logConversation({
        direction: "outbound",
        message: msg,
        intent: "other",
      });
      return;
    }

    const systemPrompt = activeListingId
      ? `${CONVERSATION_AGENT_SYSTEM}\n\n[Active listing ID: ${activeListingId}]`
      : CONVERSATION_AGENT_SYSTEM;

    const messages: Anthropic.MessageParam[] = history;

    let result = await runAgent({
      prompt: text,
      systemPrompt,
      tools: buildConversationTools(),
      model: getConversationModel(),
      messages,
      maxToolIterations: getConversationMaxToolIterations(),
      telemetryTag: "conversation_router",
      executeTool: createConversationExecuteTool({
        activeListingId,
        preferences,
        userMessage: text,
        messageId,
      }),
    });

    let dataToolName: string | undefined;

    if ("type" in result && result.type === "data") {
      dataToolName = result.toolName;
      const explanationAgent = EXPLANATION_AGENTS[dataToolName];
      result = await runAgent({
        prompt: result.data,
        systemPrompt:
          explanationAgent?.systemPrompt ?? CONVERSATION_AGENT_SYSTEM,
        model: getConversationExplanationModel(),
        telemetryTag: "conversation_explanation",
      });
    }

    const message = "message" in result ? result.message : "";
    const buttons = "buttons" in result ? result.buttons : undefined;
    const metadata = "metadata" in result ? result.metadata : undefined;

    const listingId = metadata?.listingId ?? activeListingId;
    const intent =
      metadata?.intent ??
      (dataToolName ? EXPLANATION_AGENTS[dataToolName]?.intent : null) ??
      "other";

    await logConversation({
      direction: "outbound",
      message,
      listing_id: listingId,
      intent,
    });

    if (message) {
      if (buttons && buttons.length > 0) {
        await sendWithButtons(message, buttons);
      } else {
        await sendMessage(message);
      }
    }
  } catch (e) {
    if (isAnthropicOutOfCredits(e)) {
      await sendMessage(ANTHROPIC_OUT_OF_CREDITS_MSG);
    } else if (isAnthropicRateLimited(e)) {
      await sendMessage(ANTHROPIC_RATE_LIMIT_MSG);
    }
    throw e;
  }
}

function extractListingId(text: string): string | null {
  const match = text.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return match ? match[0] : null;
}

function isShowPreferencesIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const patterns = [
    /^\/?preferences?$/,
    /(show|see|what\s*are)\s*(my\s*)?preferences?/,
    /(my\s*)?preferences?\s*(please)?/,
    /what\s*(have|did)\s*i\s*(set|configure|choose)/,
    /current\s*(search\s*)?(criteria|preferences?)/,
  ];
  return patterns.some((p) => p.test(normalized));
}

function isShowSavedIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const patterns = [
    /^\/?saved$/,
    /saved\s*(properties|list|ones?)?/,
    /(show|see|list|view)\s*(my\s*)?saved/,
    /(my\s*)?shortlist/,
    /what\s*(have|did)\s*i\s*save/,
    /saved\s*properties/,
  ];
  return patterns.some((p) => p.test(normalized));
}
