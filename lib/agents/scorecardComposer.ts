import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, logConversation } from "@/lib/supabase";
import { sendWithButtons } from "@/lib/telegram";
import { SCORECARD_COMPOSER_SYSTEM } from "@/lib/prompts";
import type { Evaluation, Listing } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function scorecardComposer(
  evaluation: Evaluation,
  listing: Listing,
  notableFlags: string[],
  commuteMinutes: number
): Promise<void> {
  const allFlags = [
    ...(evaluation.deal_breaker_flags || []),
    ...notableFlags,
  ];

  const prompt = `Format this property evaluation as a Telegram message using EXACTLY this template:

🏠 ${listing.title}
💰 £${listing.price?.toLocaleString()} · £${evaluation.monthly_mortgage}/mo

✅ Scores
  Property fit:  ${evaluation.fit_score}/10
  Area:          ${evaluation.area_score}/10
  Commute:       ${evaluation.commute_score}/10 (${commuteMinutes} min)
  Value:         ${evaluation.price_score}/10

⚠️ Watch outs
  ${allFlags.length > 0 ? allFlags.map((f) => `• ${f}`).join("\n  ") : "• None identified"}

🔗 ${listing.url}

Use this exact format. Keep watch outs concise.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system: SCORECARD_COMPOSER_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const scorecardText =
    response.content[0].type === "text" ? response.content[0].text : prompt;

  await supabaseAdmin
    .from("evaluations")
    .update({ scorecard_text: scorecardText })
    .eq("id", evaluation.id);

  await logConversation({
    direction: "outbound",
    message: scorecardText,
    listing_id: listing.id,
    intent: null,
  });

  await sendWithButtons(scorecardText, [
    { text: "👁 View", callback_data: `view:${listing.id}` },
    { text: "💾 Save", callback_data: `save:${listing.id}` },
    { text: "⏭ Skip", callback_data: `skip:${listing.id}` },
    { text: "❓ Why?", callback_data: `why:${listing.id}` },
  ]);
}
