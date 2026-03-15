import { supabaseAdmin, logConversation } from "@/lib/supabase";
import { sendWithButtons } from "@/lib/telegram";
import type { Evaluation, Listing } from "@/types";

type UnknownScores = {
  property?: boolean;
  area?: boolean;
  commute?: boolean;
};

const s = (score: number, unknown?: boolean) =>
  unknown ? "N/A  " : `${score}/10`;

export async function scorecardComposer(
  evaluation: Evaluation,
  listing: Listing,
  notableFlags: string[],
  commuteMinutes: number,
  unknownScores: UnknownScores = {}
): Promise<void> {
  const allFlags = [
    ...(evaluation.deal_breaker_flags || []),
    ...notableFlags,
  ];

  const watchOuts =
    allFlags.length > 0
      ? allFlags.map((f) => `• ${f}`).join("\n  ")
      : "• None identified";

  const commuteLabel = unknownScores.commute
    ? "N/A  "
    : `${evaluation.commute_score}/10 (${commuteMinutes} min)`;

  const scorecardText = `🏠 ${listing.title}
💰 £${listing.price?.toLocaleString()} · £${evaluation.monthly_mortgage}/mo

✅ Scores
  Property fit:  ${s(evaluation.fit_score, unknownScores.property)}
  Size:          ${s(evaluation.size_score, unknownScores.property)}
  Area:          ${s(evaluation.area_score, unknownScores.area)}
  Commute:       ${commuteLabel}
  Value:         ${s(evaluation.price_score, unknownScores.property)}

⚠️ Watch outs
  ${watchOuts}

[🔗 View listing](${listing.url})`;

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
