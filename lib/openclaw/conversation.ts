import Anthropic from "@anthropic-ai/sdk";
import {
  getPreferences,
  logConversation,
  getActiveListingId,
  getConversationHistory,
} from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
import { collectPreferences } from "@/lib/tools/preference";
import {
  saveListing,
  skipListing,
  getScorecard,
  getWhyContext,
  getFormattedPreferences,
  getFormattedSavedList,
  getComparisonData,
} from "./tools";
import {
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
} from "@/lib/prompts";
import {
  runGenericAgent,
  type ToolResult,
  type AgentButton,
} from "@/lib/agent-core";

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

  // API error payload: { type: 'error', error: { type, message }, ... }
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

const TOOLS: Anthropic.Tool[] = [
  {
    name: "skip_listing",
    description: "Dismiss a property listing the user does not want to pursue.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing to dismiss" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "save_listing",
    description: "Save or favourite a property listing for later consideration.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing to save" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_property_scorecard",
    description: "Re-display a property's evaluation scorecard with action buttons.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_saved_properties",
    description: "List all properties the user has saved or shortlisted.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "show_preferences",
    description: "Display the user's current search preferences.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_property_evaluation",
    description:
      "Fetch a property's full evaluation data so you can explain the scores to the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "get_comparison_data",
    description:
      "Fetch evaluation data for two properties so you can produce a head-to-head comparison.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id_a: { type: "string", description: "First listing UUID" },
        listing_id_b: { type: "string", description: "Second listing UUID" },
      },
      required: ["listing_id_a", "listing_id_b"],
    },
  },
  {
    name: "update_preferences",
    description:
      "Trigger the preference update flow when the user wants to change their search criteria.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

type InternalDirectResult = {
  type: "direct";
  message: string;
  listingId?: string | null;
  intent?: string | null;
  scorecard?: boolean;
  saved?: boolean;
  savedListings?: Array<{ id: string }>;
  buttons?: AgentButton[][];
};

type InternalDataResult = {
  type: "data";
  data: string;
  toolName: string;
};

type InternalToolResult = InternalDirectResult | InternalDataResult;

async function executeToolInternal(
  toolName: string,
  toolInput: Record<string, string>,
  activeListingId: string | null,
  preferences: NonNullable<Awaited<ReturnType<typeof getPreferences>>>,
  userMessage: string,
  messageId: string
): Promise<InternalToolResult> {
  const listingId = toolInput.listing_id ?? activeListingId;

  switch (toolName) {
    case "skip_listing": {
      if (!listingId) {
        return { type: "direct", message: "Which property would you like to skip?" };
      }
      await skipListing(listingId);
      return {
        type: "direct",
        message: "Done — property dismissed. 👋",
        listingId,
        intent: "skip",
      };
    }

    case "save_listing": {
      if (!listingId) {
        return { type: "direct", message: "Which property would you like to save?" };
      }
      await saveListing(listingId);
      return {
        type: "direct",
        message: "Saved! ⭐️ I'll keep that one for you.",
        listingId,
        intent: "save",
      };
    }

    case "show_property_scorecard": {
      if (!listingId) {
        return {
          type: "direct",
          message:
            "Which property would you like to see? Tap a scorecard button or mention the property.",
        };
      }
      const scorecardResult = await getScorecard(listingId);
      if (!scorecardResult.ok) {
        return {
          type: "direct",
          message: scorecardResult.message,
        };
      }
      return {
        type: "direct",
        message: scorecardResult.scorecardText,
        listingId: scorecardResult.listingId,
        intent: "other",
        scorecard: true,
        saved: scorecardResult.buttons[0]?.some(
          (b) => b.callback_data.startsWith("unsave:"),
        ),
        buttons: scorecardResult.buttons,
      };
    }

    case "show_saved_properties": {
      const savedResult = await getFormattedSavedList();
      if (!savedResult.ok) {
        return { type: "direct", message: savedResult.message };
      }
      return {
        type: "direct",
        message: savedResult.message,
        intent: "other",
        savedListings: savedResult.savedListings.map((l) => ({ id: l.id })),
      };
    }

    case "show_preferences": {
      const prefsResult = await getFormattedPreferences();
      if (!prefsResult.ok) {
        return { type: "direct", message: "No preferences set." };
      }
      return {
        type: "direct",
        message: prefsResult.message,
        intent: "preferences",
        buttons: prefsResult.buttons,
      };
    }

    case "get_property_evaluation": {
      if (!listingId) {
        return {
          type: "data",
          data: "No listing ID found. Ask the user which property they mean.",
          toolName,
        };
      }
      const whyResult = await getWhyContext(listingId);
      if (!whyResult.ok) {
        return {
          type: "data",
          data: whyResult.error,
          toolName,
        };
      }
      return { type: "data", data: whyResult.context, toolName };
    }

    case "get_comparison_data": {
      const idA = toolInput.listing_id_a;
      const idB = toolInput.listing_id_b;
      if (!idA || !idB) {
        return {
          type: "data",
          data: "Please mention the IDs of the two properties you'd like to compare.",
          toolName,
        };
      }
      const result = await getComparisonData(idA, idB);
      const data = result.ok ? result.data : result.message;
      return { type: "data", data, toolName };
    }

    case "update_preferences": {
      // collectPreferences manages its own LLM call and sends the response itself
      await collectPreferences(userMessage, messageId);
      return { type: "direct", message: "", intent: "preferences" };
    }

    default:
      return { type: "data", data: `Unknown tool: ${toolName}`, toolName };
  }
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

function createExecuteTool(
  activeListingId: string | null,
  preferences: NonNullable<Awaited<ReturnType<typeof getPreferences>>>,
  userMessage: string,
  messageId: string
): (name: string, input: Record<string, unknown>) => Promise<ToolResult> {
  return async (
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> => {
    const toolInput = input as Record<string, string>;
    const result = await executeToolInternal(
      name,
      toolInput,
      activeListingId,
      preferences,
      userMessage,
      messageId
    );
    if (result.type === "direct") {
      let buttons: AgentButton[][] | undefined;
      if (result.buttons && result.buttons.length > 0) {
        buttons = result.buttons;
      } else if (result.scorecard && result.listingId) {
        const saveButton = result.saved
          ? { text: "🗑 Unsave", callback_data: `unsave:${result.listingId}` }
          : { text: "💾 Save", callback_data: `save:${result.listingId}` };
        const scorecardButtons = [
          saveButton,
          ...(result.saved ? [] : [{ text: "⏭ Skip", callback_data: `skip:${result.listingId}` }]),
          { text: "❓ Why?", callback_data: `why:${result.listingId}` },
        ];
        buttons = [scorecardButtons];
      } else if (result.savedListings && result.savedListings.length > 0) {
        buttons = result.savedListings.map((l, i) => [
          { text: `📋 ${i + 1}`, callback_data: `scorecard:${l.id}` },
        ]);
      }
      return {
        type: "direct",
        message: result.message,
        metadata: { listingId: result.listingId, intent: result.intent },
        buttons,
      };
    }
    return result;
  };
}

export async function conversationAgent(
  text: string,
  messageId: string
): Promise<void> {
  // Dedup guard — bail if this Telegram message was already processed
  const { inserted } = await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: text,
  });
  if (!inserted) return;

  try {
    const preferences = await getPreferences();
    if (!preferences) {
      await collectPreferences(text, messageId);
      return;
    }

    // Direct path for "show preferences" — guarantees fresh data from DB
    if (isShowPreferencesIntent(text)) {
      const executeTool = createExecuteTool(null, preferences, text, messageId);
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

    // Direct path for "show saved properties" — guarantees Remove buttons
    if (isShowSavedIntent(text)) {
      const executeTool = createExecuteTool(null, preferences, text, messageId);
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
          await sendMessage(result.message, { disable_web_page_preview: true });
        }
      }
      return;
    }

    const history = await getConversationHistory(8);
    const listingIdFromText = extractListingId(text);
    const activeListingId = listingIdFromText ?? (await getActiveListingId(10));

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

    let result = await runGenericAgent({
      prompt: text,
      systemPrompt,
      tools: TOOLS,
      messages,
      executeTool: createExecuteTool(
        activeListingId,
        preferences,
        text,
        messageId
      ),
    });

    let dataToolName: string | undefined;

    // Tool returned data — run explanation agent
    if ("type" in result && result.type === "data") {
      dataToolName = result.toolName;
      const explanationAgent = EXPLANATION_AGENTS[dataToolName];
      result = await runGenericAgent({
        prompt: result.data,
        systemPrompt:
          explanationAgent?.systemPrompt ?? CONVERSATION_AGENT_SYSTEM,
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
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
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

export { conversationAgent as default };
