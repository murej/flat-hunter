import Anthropic from "@anthropic-ai/sdk";
import { getPreferences, supabaseAdmin, logConversation, updateListingStatus } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";
import { preferenceAgent } from "./preference";
import { viewingAgent } from "./viewingAgent";
import {
  INTENT_CLASSIFIER_SYSTEM,
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
} from "@/lib/prompts";
import type { TelegramMessage } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function conversationAgent(
  text: string,
  messageId: string
): Promise<void> {
  const preferences = await getPreferences();

  if (!preferences) {
    await preferenceAgent(text, messageId);
    return;
  }

  const updateKeywords = ["update preferences", "change preferences", "edit preferences", "reset preferences"];
  if (updateKeywords.some((kw) => text.toLowerCase().includes(kw))) {
    await preferenceAgent(text, messageId);
    return;
  }

  const intent = await classifyIntent(text);

  await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: text,
    intent,
  });

  const listingId = extractListingId(text);

  switch (intent) {
    case "view":
      await handleView(listingId, messageId);
      break;
    case "skip":
      await handleSkip(listingId);
      break;
    case "save":
      await handleSave(listingId);
      break;
    case "why":
      await handleWhy(listingId);
      break;
    case "show_saved":
      await handleShowSaved();
      break;
    case "compare":
      await handleCompare(text);
      break;
    case "preferences":
      await handleShowPreferences(preferences);
      break;
    default:
      await handleGeneral(text, listingId, preferences);
  }
}

async function classifyIntent(text: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16,
    system: INTENT_CLASSIFIER_SYSTEM,
    messages: [{ role: "user", content: text }],
  });

  const intent =
    response.content[0].type === "text"
      ? response.content[0].text.trim().toLowerCase()
      : "other";

  return intent;
}

function extractListingId(text: string): string | null {
  const match = text.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return match ? match[0] : null;
}

async function handleView(
  listingId: string | null,
  messageId: string
): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property would you like to view? Please provide the listing ID.");
    return;
  }

  const draft = await viewingAgent.draftEmail(listingId);

  const msg = `Here's a draft viewing request email:\n\n---\n${draft}\n---\n\nReply "send" to send it, or suggest edits.`;

  await logConversation({
    direction: "outbound",
    message: msg,
    listing_id: listingId,
    intent: "view",
  });

  await sendMessage(msg);
}

async function handleSkip(listingId: string | null): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property would you like to skip?");
    return;
  }

  await updateListingStatus(listingId, "dismissed");

  const msg = "Done — property dismissed. 👋";
  await logConversation({
    direction: "outbound",
    message: msg,
    listing_id: listingId,
    intent: "skip",
  });
  await sendMessage(msg);
}

async function handleSave(listingId: string | null): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property would you like to save?");
    return;
  }

  await updateListingStatus(listingId, "saved");

  const msg = "Saved! ⭐️ I'll keep that one for you.";
  await logConversation({
    direction: "outbound",
    message: msg,
    listing_id: listingId,
    intent: "save",
  });
  await sendMessage(msg);
}

async function handleWhy(listingId: string | null): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property's scores would you like explained?");
    return;
  }

  const { data: evaluation } = await supabaseAdmin
    .from("evaluations")
    .select("*")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!evaluation) {
    await sendMessage("I couldn't find an evaluation for that property.");
    return;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system: WHY_EXPLANATION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Explain the scores for this evaluation:\n${JSON.stringify(evaluation, null, 2)}`,
      },
    ],
  });

  const explanation =
    response.content[0].type === "text" ? response.content[0].text : "";

  await logConversation({
    direction: "outbound",
    message: explanation,
    listing_id: listingId,
    intent: "why",
  });

  await sendMessage(explanation);
}

async function handleShowSaved(): Promise<void> {
  const { data: listings } = await supabaseAdmin
    .from("listings")
    .select("id, title, price, address, url")
    .eq("status", "saved")
    .order("created_at", { ascending: false });

  if (!listings || listings.length === 0) {
    await sendMessage("You haven't saved any properties yet.");
    return;
  }

  const list = listings
    .map(
      (l, i) =>
        `${i + 1}. *${l.title}*\n   £${l.price?.toLocaleString()} · ${l.address}\n   ${l.url}`
    )
    .join("\n\n");

  const msg = `⭐️ *Your saved properties:*\n\n${list}`;

  await logConversation({
    direction: "outbound",
    message: msg,
    intent: "show_saved",
  });

  await sendMessage(msg);
}

async function handleCompare(text: string): Promise<void> {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const ids = text.match(uuidRegex);

  if (!ids || ids.length < 2) {
    await sendMessage(
      "Please mention the IDs of the two properties you'd like to compare."
    );
    return;
  }

  const [evalA, evalB] = await Promise.all([
    supabaseAdmin
      .from("evaluations")
      .select("*")
      .eq("listing_id", ids[0])
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin
      .from("evaluations")
      .select("*")
      .eq("listing_id", ids[1])
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (!evalA.data || !evalB.data) {
    await sendMessage("Couldn't find evaluations for both properties.");
    return;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 768,
    system: COMPARISON_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Compare these two properties:\n\nProperty A:\n${JSON.stringify(evalA.data, null, 2)}\n\nProperty B:\n${JSON.stringify(evalB.data, null, 2)}`,
      },
    ],
  });

  const comparison =
    response.content[0].type === "text" ? response.content[0].text : "";

  await logConversation({
    direction: "outbound",
    message: comparison,
    intent: "compare",
  });

  await sendMessage(comparison);
}

async function handleShowPreferences(
  preferences: Record<string, unknown>
): Promise<void> {
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
    freeform_notes?: string;
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

  await logConversation({ direction: "outbound", message: msg, intent: "preferences" });
  await sendMessage(msg);
}

async function handleGeneral(
  text: string,
  listingId: string | null,
  preferences?: Record<string, unknown> | null
): Promise<void> {
  let context = "";
  if (preferences) {
    context += `\nUser preferences: ${JSON.stringify(preferences)}`;
  }
  if (listingId) {
    const { data: listing } = await supabaseAdmin
      .from("listings")
      .select("*")
      .eq("id", listingId)
      .single();

    const { data: evaluation } = await supabaseAdmin
      .from("evaluations")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (listing) context += `\nListing: ${JSON.stringify(listing)}`;
    if (evaluation) context += `\nEvaluation: ${JSON.stringify(evaluation)}`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system: CONVERSATION_AGENT_SYSTEM,
    messages: [
      {
        role: "user",
        content: context ? `${text}\n\nContext:${context}` : text,
      },
    ],
  });

  const reply =
    response.content[0].type === "text" ? response.content[0].text : "";

  await logConversation({
    direction: "outbound",
    message: reply,
    listing_id: listingId,
    intent: "other",
  });

  await sendMessage(reply);
}

// Named export for use in telegram route
export { conversationAgent as default };
