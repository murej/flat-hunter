import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, logConversation, getPreferences } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";
import { PREFERENCE_COLLECTOR_SYSTEM } from "@/lib/prompts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function collectPreferences(
  userMessage: string,
  messageId: string
): Promise<void> {
  await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: userMessage,
    intent: "preferences",
  });

  // Fetch latest 60 messages descending then reverse, so Claude sees recent context
  const { data: historyDesc } = await supabaseAdmin
    .from("conversations")
    .select("direction, message")
    .eq("intent", "preferences")
    .order("created_at", { ascending: false })
    .limit(60);

  const history = (historyDesc || []).reverse();

  const messages: Anthropic.MessageParam[] = (history || []).map((row) => ({
    role: row.direction === "inbound" ? "user" : "assistant",
    content: row.message,
  }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: userMessage });
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: PREFERENCE_COLLECTOR_SYSTEM,
    messages,
  });

  const assistantText =
    response.content[0].type === "text" ? response.content[0].text : "";

  await logConversation({
    direction: "outbound",
    message: assistantText,
    intent: "preferences",
  });

  const prefMatch = assistantText.match(
    /<preferences>([\s\S]*?)<\/preferences>/
  );
  if (prefMatch) {
    try {
      const parsed = JSON.parse(prefMatch[1].trim());
      const existing = await getPreferences();

      const merged = {
        areas: parsed.areas !== undefined ? parsed.areas : (existing?.areas ?? []),
        max_price: parsed.max_price !== undefined ? parsed.max_price : (existing?.max_price ?? 0),
        deposit: parsed.deposit !== undefined ? parsed.deposit : (existing?.deposit ?? 0),
        min_bedrooms: parsed.min_bedrooms !== undefined ? parsed.min_bedrooms : (existing?.min_bedrooms ?? 1),
        must_haves: parsed.must_haves !== undefined ? parsed.must_haves : (existing?.must_haves ?? []),
        deal_breakers: parsed.deal_breakers !== undefined ? parsed.deal_breakers : (existing?.deal_breakers ?? []),
        commute_anchor: parsed.commute_anchor !== undefined ? parsed.commute_anchor : (existing?.commute_anchor ?? ""),
        commute_anchor_postcode: parsed.commute_anchor_postcode !== undefined ? parsed.commute_anchor_postcode : (existing?.commute_anchor_postcode ?? ""),
        max_commute_minutes: parsed.max_commute_minutes !== undefined ? parsed.max_commute_minutes : (existing?.max_commute_minutes ?? 60),
        style_notes: parsed.style_notes !== undefined ? parsed.style_notes : (existing?.style_notes ?? ""),
        freeform_notes: parsed.freeform_notes !== undefined ? parsed.freeform_notes : (existing?.freeform_notes ?? ""),
      };

      const payload: Record<string, unknown> = {
        ...merged,
        raw_json: { ...merged, score_weights: parsed.score_weights ?? (existing?.raw_json as Record<string, unknown>)?.score_weights },
        updated_at: new Date().toISOString(),
      };
      if (existing?.id) {
        payload.id = existing.id;
      }

      await supabaseAdmin.from("preferences").upsert(payload);

      const confirmText =
        assistantText.replace(/<preferences>[\s\S]*?<\/preferences>/, "").trim() +
        "\n\n✅ Your preferences have been saved!";

      await sendMessage(confirmText);
    } catch (e) {
      console.error("Failed to parse preferences JSON:", e);
      await sendMessage(assistantText);
    }
  } else {
    await sendMessage(assistantText);
  }
}
