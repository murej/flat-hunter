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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

type DirectResult = {
  type: "direct";
  message: string;
  listingId?: string | null;
  intent?: string | null;
  scorecard?: boolean;
};

type DataResult = {
  type: "data";
  data: string;
  toolName: string;
};

type ToolResult = DirectResult | DataResult;

async function executeTool(
  toolName: string,
  toolInput: Record<string, string>,
  activeListingId: string | null,
  preferences: NonNullable<Awaited<ReturnType<typeof getPreferences>>>,
  userMessage: string,
  messageId: string
): Promise<ToolResult> {
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
      const { data: evaluation } = await supabaseAdmin
        .from("evaluations")
        .select("scorecard_text")
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
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
            `${i + 1}. *${l.title}*\n   £${l.price?.toLocaleString()} · ${l.address}\n   ${l.url}`
        )
        .join("\n\n");
      return {
        type: "direct",
        message: `⭐️ *Your saved properties:*\n\n${list}`,
        intent: "other",
      };
    }

    case "show_preferences": {
      const p = preferences as {
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
        `🏠 *Style:* ${p.style_notes || "Not set"}`,
        ``,
        `_Say "update preferences" to change any of these._`,
      ].join("\n");
      return { type: "direct", message: msg, intent: "preferences" };
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
          return {
            type: "direct",
            message:
              "⚠️ I don't have the agent's email address for this property. You'll need to contact them directly via the listing URL.",
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

const SECOND_PASS_SYSTEM: Record<string, string> = {
  get_property_evaluation: WHY_EXPLANATION_SYSTEM,
  get_comparison_data: COMPARISON_SYSTEM,
  get_listing_for_viewing: VIEWING_EMAIL_SYSTEM,
};

const SECOND_PASS_INTENT: Record<string, string> = {
  get_property_evaluation: "why",
  get_comparison_data: "compare",
  get_listing_for_viewing: "view",
};

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

    const history = await getConversationHistory(8);
    const listingIdFromText = extractListingId(text);
    const activeListingId = listingIdFromText ?? (await getActiveListingId(10));

    const systemPrompt = activeListingId
      ? `${CONVERSATION_AGENT_SYSTEM}\n\n[Active listing ID: ${activeListingId}]`
      : CONVERSATION_AGENT_SYSTEM;

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: text },
    ];

    // Single LLM call — Claude either responds directly or invokes a tool
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    // No tool called — Claude responded directly (general conversation)
    if (!toolBlock) {
      const reply = textBlock?.text ?? "";
      await logConversation({
        direction: "outbound",
        message: reply,
        listing_id: activeListingId,
        intent: "other",
      });
      await sendMessage(reply);
      return;
    }

    // Tool called — execute it
    const toolInput = toolBlock.input as Record<string, string>;
    const result = await executeTool(
      toolBlock.name,
      toolInput,
      activeListingId,
      preferences,
      text,
      messageId
    );

    if (result.type === "direct") {
      // Action complete — send the pre-formed message without a second LLM call
      if (result.message) {
        await logConversation({
          direction: "outbound",
          message: result.message,
          listing_id: result.listingId ?? activeListingId,
          intent: result.intent ?? null,
        });
        if (result.scorecard && result.listingId) {
          await sendWithButtons(result.message, [
            { text: "👁 View", callback_data: `view:${result.listingId}` },
            { text: "💾 Save", callback_data: `save:${result.listingId}` },
            { text: "⏭ Skip", callback_data: `skip:${result.listingId}` },
            { text: "❓ Why?", callback_data: `why:${result.listingId}` },
          ]);
        } else {
          await sendMessage(result.message);
        }
      }
      return;
    }

    // Tool returned data — second LLM call to formulate the response
    const secondPassMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: toolBlock.id,
            content: result.data,
          },
        ],
      },
    ];

    const finalResponse = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SECOND_PASS_SYSTEM[result.toolName] ?? CONVERSATION_AGENT_SYSTEM,
      messages: secondPassMessages,
    });

    const finalText =
      finalResponse.content[0]?.type === "text"
        ? finalResponse.content[0].text
        : "";

    await logConversation({
      direction: "outbound",
      message: finalText,
      listing_id: activeListingId,
      intent: SECOND_PASS_INTENT[result.toolName] ?? "other",
    });

    await sendMessage(finalText);
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

export { conversationAgent as default };
