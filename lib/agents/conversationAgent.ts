import OpenAI from "openai";
import {
  getPreferences,
  supabaseAdmin,
  logConversation,
  updateListingStatus,
  getActiveListingId,
  getConversationHistory,
} from "@/lib/supabase";
import { sendMessage, sendWithButtons } from "@/lib/telegram";
import { preferenceAgent } from "./preference";
import { viewingAgent } from "./viewingAgent";
import {
  INTENT_CLASSIFIER_SYSTEM,
  CONVERSATION_AGENT_SYSTEM,
  WHY_EXPLANATION_SYSTEM,
  COMPARISON_SYSTEM,
} from "@/lib/prompts";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export async function conversationAgent(
  text: string,
  messageId: string
): Promise<void> {
  // Log inbound first — the DB unique index on telegram_message_id acts as a
  // dedup guard: if this message was already processed (e.g. Telegram retry),
  // the insert returns inserted=false and we bail before any LLM calls.
  const { inserted } = await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: text,
  });
  if (!inserted) return;

  const preferences = await getPreferences();

  if (!preferences) {
    await preferenceAgent(text, messageId);
    return;
  }

  // Fetch shared context once — used by classifier and handlers
  const history = await getConversationHistory(8);
  const listingIdFromText = extractListingId(text);
  const activeListingId =
    listingIdFromText ?? (await getActiveListingId(10));

  const intent = await classifyIntent(text, history);

  switch (intent) {
    case "view":
      await handleView(activeListingId, messageId);
      break;
    case "confirm_send":
      await handleConfirmSend(activeListingId);
      break;
    case "skip":
      await handleSkip(activeListingId);
      break;
    case "save":
      await handleSave(activeListingId);
      break;
    case "why":
      await handleWhy(activeListingId, history);
      break;
    case "show_saved":
      await handleShowSaved();
      break;
    case "compare":
      await handleCompare(text, history);
      break;
    case "show_property":
      await handleShowProperty(activeListingId);
      break;
    case "show_preferences":
      await handleShowPreferences(preferences);
      break;
    case "update_preferences":
      await preferenceAgent(text, messageId);
      break;
    default:
      await handleGeneral(text, activeListingId, preferences, history);
  }
}

async function classifyIntent(
  text: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 16,
    messages: [
      { role: "system", content: INTENT_CLASSIFIER_SYSTEM },
      ...history,
      { role: "user", content: text },
    ],
  });

  return (response.choices[0].message.content ?? "other").trim().toLowerCase();
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
    await sendMessage("Which property would you like to view? Tap the *View* button on a scorecard or mention the property.");
    return;
  }

  const draft = await viewingAgent.draftEmail(listingId);

  const msg = `Here's a draft viewing request email:\n\n---\n${draft}\n---\n\nReply *"send it"* to send, or tell me what to change.`;

  await logConversation({
    direction: "outbound",
    message: msg,
    listing_id: listingId,
    intent: "view",
  });

  await sendMessage(msg);
}

async function handleConfirmSend(listingId: string | null): Promise<void> {
  if (!listingId) {
    // Fall back to finding the most recent view-intent conversation
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("listing_id")
      .eq("intent", "view")
      .not("listing_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    listingId = data?.listing_id ?? null;
  }

  if (!listingId) {
    await sendMessage("I'm not sure which property's email to send. Please tap the View button on a scorecard first.");
    return;
  }

  try {
    await viewingAgent.sendEmail(listingId);

    const msg = "✅ Viewing request sent! I'll let you know if we hear back.";
    await logConversation({
      direction: "outbound",
      message: msg,
      listing_id: listingId,
      intent: "confirm_send",
    });
    await sendMessage(msg);
  } catch (e) {
    const err = e as Error;
    if (err.message.includes("No agent email")) {
      const msg =
        "⚠️ I don't have the agent's email address for this property. You'll need to contact them directly via the listing URL.";
      await logConversation({
        direction: "outbound",
        message: msg,
        listing_id: listingId,
        intent: "confirm_send",
      });
      await sendMessage(msg);
    } else {
      throw e;
    }
  }
}

async function handleShowProperty(listingId: string | null): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property would you like to see? Tap a scorecard button or mention the property.");
    return;
  }

  const { data: evaluation } = await supabaseAdmin
    .from("evaluations")
    .select("scorecard_text")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!evaluation?.scorecard_text) {
    await sendMessage("I couldn't find a scorecard for that property — it may not have been evaluated yet.");
    return;
  }

  await logConversation({
    direction: "outbound",
    message: evaluation.scorecard_text,
    listing_id: listingId,
    intent: "show_property",
  });

  await sendWithButtons(evaluation.scorecard_text, [
    { text: "👁 View", callback_data: `view:${listingId}` },
    { text: "💾 Save", callback_data: `save:${listingId}` },
    { text: "⏭ Skip", callback_data: `skip:${listingId}` },
    { text: "❓ Why?", callback_data: `why:${listingId}` },
  ]);
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

async function handleWhy(
  listingId: string | null,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<void> {
  if (!listingId) {
    await sendMessage("Which property's scores would you like explained?");
    return;
  }

  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("title, address, price")
    .eq("id", listingId)
    .single();

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

  const context = listing
    ? `Property: ${listing.title} at ${listing.address} (£${listing.price?.toLocaleString()})\n\nEvaluation:\n${JSON.stringify(evaluation, null, 2)}`
    : `Evaluation:\n${JSON.stringify(evaluation, null, 2)}`;

  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 768,
    messages: [
      { role: "system", content: WHY_EXPLANATION_SYSTEM },
      ...history,
      {
        role: "user",
        content: `Explain the scores for this property.\n\n${context}`,
      },
    ],
  });

  const explanation = response.choices[0].message.content ?? "";

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

async function handleCompare(
  text: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<void> {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const ids = text.match(uuidRegex);

  if (!ids || ids.length < 2) {
    await sendMessage(
      "Please mention the IDs of the two properties you'd like to compare."
    );
    return;
  }

  const [evalA, evalB, listingA, listingB] = await Promise.all([
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
    supabaseAdmin
      .from("listings")
      .select("title, address, price")
      .eq("id", ids[0])
      .single(),
    supabaseAdmin
      .from("listings")
      .select("title, address, price")
      .eq("id", ids[1])
      .single(),
  ]);

  if (!evalA.data || !evalB.data) {
    await sendMessage("Couldn't find evaluations for both properties.");
    return;
  }

  const labelA = listingA.data
    ? `${listingA.data.title} (${listingA.data.address})`
    : ids[0];
  const labelB = listingB.data
    ? `${listingB.data.title} (${listingB.data.address})`
    : ids[1];

  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 1024,
    messages: [
      { role: "system", content: COMPARISON_SYSTEM },
      ...history,
      {
        role: "user",
        content: `Compare these two properties:\n\nProperty A — ${labelA}:\n${JSON.stringify(evalA.data, null, 2)}\n\nProperty B — ${labelB}:\n${JSON.stringify(evalB.data, null, 2)}`,
      },
    ],
  });

  const comparison = response.choices[0].message.content ?? "";

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
  preferences: Record<string, unknown> | null,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<void> {
  let contextBlock = "";

  if (preferences) {
    contextBlock += `\n\n[User preferences]\n${JSON.stringify(preferences, null, 2)}`;
  }

  if (listingId) {
    const [{ data: listing }, { data: evaluation }] = await Promise.all([
      supabaseAdmin.from("listings").select("*").eq("id", listingId).single(),
      supabaseAdmin
        .from("evaluations")
        .select("*")
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (listing)
      contextBlock += `\n\n[Current listing]\n${JSON.stringify(listing, null, 2)}`;
    if (evaluation)
      contextBlock += `\n\n[Listing evaluation]\n${JSON.stringify(evaluation, null, 2)}`;
  }

  const userMessage = contextBlock
    ? `${text}\n\n---${contextBlock}`
    : text;

  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 768,
    messages: [
      { role: "system", content: CONVERSATION_AGENT_SYSTEM },
      ...history,
      { role: "user", content: userMessage },
    ],
  });

  const reply = response.choices[0].message.content ?? "";

  await logConversation({
    direction: "outbound",
    message: reply,
    listing_id: listingId,
    intent: "other",
  });

  await sendMessage(reply);
}

export { conversationAgent as default };
