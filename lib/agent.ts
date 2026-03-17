import Anthropic from "@anthropic-ai/sdk";
import {
  getPreferences,
  getListing,
  supabaseAdmin,
  logConversation,
  updateListingStatus,
  getActiveListingId,
  getConversationHistory,
} from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
import { collectPreferences } from "./tools/preference";
import { requestViewing } from "./tools/viewing";
import {
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
  VIEWING_EMAIL_SYSTEM,
} from "@/lib/prompts";
import {
  runGenericAgent,
  type ToolResult,
  type AgentButton,
} from "./agent-core";

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
    name: "get_listing_for_viewing",
    description:
      "Fetch listing details so you can draft a viewing request email for the user to review.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "send_viewing_email",
    description:
      "Send a viewing request email to the estate agent. Provide the complete email body exactly as it should be sent.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
        email_body: {
          type: "string",
          description: "Complete email body text to send to the agent",
        },
      },
      required: ["listing_id", "email_body"],
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
      await updateListingStatus(listingId, "dismissed");
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
      await updateListingStatus(listingId, "saved");
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
      const [
        { data: evaluation },
        { data: listing },
      ] = await Promise.all([
        supabaseAdmin
          .from("evaluations")
          .select("scorecard_text")
          .eq("listing_id", listingId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabaseAdmin
          .from("listings")
          .select("status")
          .eq("id", listingId)
          .single(),
      ]);
      if (!evaluation?.scorecard_text) {
        return {
          type: "direct",
          message:
            "I couldn't find a scorecard for that property — it may not have been evaluated yet.",
        };
      }
      return {
        type: "direct",
        message: evaluation.scorecard_text,
        listingId,
        intent: "other",
        scorecard: true,
        saved: listing?.status === "saved",
      };
    }

    case "show_saved_properties": {
      const { data: listings } = await supabaseAdmin
        .from("listings")
        .select("id, title, price, address, url")
        .eq("status", "saved")
        .order("created_at", { ascending: false });
      if (!listings || listings.length === 0) {
        return { type: "direct", message: "You haven't saved any properties yet." };
      }
      const list = listings
        .map(
          (
            l: { title: string; price: number; address: string; url: string },
            i: number
          ) =>
            `${i + 1}. *${l.title}*\n   £${l.price?.toLocaleString()} · ${l.address}\n   [🔗 View listing](${l.url})`
        )
        .join("\n\n");
      return {
        type: "direct",
        message: `⭐️ *Your saved properties:*\n\n${list}`,
        intent: "other",
        savedListings: listings.map((l: { id: string }) => ({ id: l.id })),
      };
    }

    case "show_preferences": {
      const fresh = await getPreferences();
      const p = (fresh ?? preferences) as {
        areas?: string[];
        max_price?: number;
        deposit?: number;
        min_bedrooms?: number;
        commute_anchor?: string;
        commute_anchor_postcode?: string;
        max_commute_minutes?: number;
        must_haves?: string[];
        deal_breakers?: string[];
        style_notes?: string;
        area_preferences?: string[];
      };
      const msg = [
        `📋 *Your current preferences:*`,
        ``,
        `📍 *Areas:* ${p.areas?.join(", ") || "Not set"}`,
        `💰 *Max price:* £${p.max_price?.toLocaleString() || "Not set"}`,
        `💵 *Deposit:* £${p.deposit?.toLocaleString() || "Not set"}`,
        `🛏 *Min bedrooms:* ${p.min_bedrooms || "Not set"}`,
        `🚇 *Commute to:* ${p.commute_anchor_postcode || p.commute_anchor || "Not set"} (max ${p.max_commute_minutes} min)`,
        `✅ *Must-haves:* ${p.must_haves?.join(", ") || "None specified"}`,
        `❌ *Deal-breakers:* ${p.deal_breakers?.join(", ") || "None specified"}`,
        `🏘 *Area preferences:* ${p.area_preferences?.join(", ") || "None specified"}`,
        `🏠 *Style:* ${p.style_notes || "Not set"}`,
        ``,
      ].join("\n");
      return {
        type: "direct",
        message: msg,
        intent: "preferences",
        buttons: [[{ text: "Update", callback_data: "update preferences" }]],
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
      const [{ data: listing }, { data: evaluation }] = await Promise.all([
        supabaseAdmin
          .from("listings")
          .select("title, address, price")
          .eq("id", listingId)
          .single(),
        supabaseAdmin
          .from("evaluations")
          .select("*")
          .eq("listing_id", listingId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
      ]);
      if (!evaluation) {
        return {
          type: "data",
          data: "No evaluation found for this property.",
          toolName,
        };
      }
      const context = listing
        ? `Property: ${listing.title} at ${listing.address} (£${listing.price?.toLocaleString()})\n\nEvaluation:\n${JSON.stringify(evaluation, null, 2)}`
        : `Evaluation:\n${JSON.stringify(evaluation, null, 2)}`;
      return { type: "data", data: context, toolName };
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
      const [evalA, evalB, listingA, listingB] = await Promise.all([
        supabaseAdmin
          .from("evaluations")
          .select("*")
          .eq("listing_id", idA)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabaseAdmin
          .from("evaluations")
          .select("*")
          .eq("listing_id", idB)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabaseAdmin
          .from("listings")
          .select("title, address, price")
          .eq("id", idA)
          .single(),
        supabaseAdmin
          .from("listings")
          .select("title, address, price")
          .eq("id", idB)
          .single(),
      ]);
      const labelA = listingA.data
        ? `${listingA.data.title} (${listingA.data.address})`
        : idA;
      const labelB = listingB.data
        ? `${listingB.data.title} (${listingB.data.address})`
        : idB;
      const data =
        evalA.data && evalB.data
          ? `Property A — ${labelA}:\n${JSON.stringify(evalA.data, null, 2)}\n\nProperty B — ${labelB}:\n${JSON.stringify(evalB.data, null, 2)}`
          : "Could not find evaluations for both properties.";
      return { type: "data", data, toolName };
    }

    case "get_listing_for_viewing": {
      if (!listingId) {
        return {
          type: "data",
          data: "No listing ID found. Ask the user which property they'd like to view.",
          toolName,
        };
      }
      const listing = await getListing(listingId);
      return {
        type: "data",
        data: JSON.stringify({
          listing_id: listingId,
          title: listing.title,
          address: listing.address,
          agent_name: listing.agent_name,
          agent_email: listing.agent_email,
          url: listing.url,
          price: listing.price,
        }),
        toolName,
      };
    }

    case "send_viewing_email": {
      if (!listingId || !toolInput.email_body) {
        return {
          type: "direct",
          message:
            "I'm not sure which property's email to send. Please tap the View button on a scorecard first.",
        };
      }
      try {
        await requestViewing.sendEmailBody(listingId, toolInput.email_body);
        return {
          type: "direct",
          message: "✅ Viewing request sent! I'll let you know if we hear back.",
          listingId,
          intent: "view",
        };
      } catch (e) {
        const err = e as Error;
        if (err.message.includes("No agent email")) {
          const listing = await getListing(listingId);
          return {
            type: "direct",
            message: `⚠️ I don't have the agent's email address for this property. Contact them directly: [🔗 View listing](${listing.url})`,
            listingId,
            intent: "view",
          };
        }
        throw e;
      }
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
  get_listing_for_viewing: {
    systemPrompt: VIEWING_EMAIL_SYSTEM,
    intent: "view",
  },
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
          { text: "👁 View", callback_data: `view:${result.listingId}` },
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
          await sendWithButtons(result.message, result.buttons);
        } else {
          await sendMessage(result.message);
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
