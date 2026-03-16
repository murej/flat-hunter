import OpenAI from "openai";
import { supabaseAdmin, logConversation } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";
import { PREFERENCE_COLLECTOR_SYSTEM } from "@/lib/prompts";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export async function preferenceAgent(
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

  const messages: Array<{ role: "user" | "assistant"; content: string }> = (history || []).map((row) => ({
    role: row.direction === "inbound" ? "user" : "assistant",
    content: row.message,
  }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: userMessage });
  }

  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 1024,
    messages: [
      { role: "system", content: PREFERENCE_COLLECTOR_SYSTEM },
      ...messages,
    ],
  });

  const assistantText = response.choices[0].message.content ?? "";

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
      await supabaseAdmin.from("preferences").upsert({
        areas: parsed.areas ?? [],
        max_price: parsed.max_price ?? 0,
        deposit: parsed.deposit ?? 0,
        min_bedrooms: parsed.min_bedrooms ?? 1,
        must_haves: parsed.must_haves ?? [],
        deal_breakers: parsed.deal_breakers ?? [],
        commute_anchor: parsed.commute_anchor ?? "",
        commute_anchor_postcode: parsed.commute_anchor_postcode ?? "",
        max_commute_minutes: parsed.max_commute_minutes ?? 60,
        style_notes: parsed.style_notes ?? "",
        freeform_notes: parsed.freeform_notes ?? "",
        raw_json: parsed,
        updated_at: new Date().toISOString(),
      });

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
