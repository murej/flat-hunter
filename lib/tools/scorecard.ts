import type { Evaluation, Listing } from "@/types";

export type ScorecardButton = { text: string; callback_data: string };

export function buildScorecardButtons(
  listingId: string,
  isSaved: boolean,
): ScorecardButton[][] {
  const saveButton: ScorecardButton = isSaved
    ? { text: "🗑 Unsave", callback_data: `unsave:${listingId}` }
    : { text: "💾 Save", callback_data: `save:${listingId}` };
  const skipButton: ScorecardButton = {
    text: "⏭ Skip",
    callback_data: `skip:${listingId}`,
  };
  const whyButton: ScorecardButton = {
    text: "❓ Why?",
    callback_data: `why:${listingId}`,
  };
  return [
    [
      saveButton,
      ...(isSaved ? [] : [skipButton]),
      whyButton,
    ],
  ];
}

type UnknownScores = {
  property?: boolean;
  area?: boolean;
  commute?: boolean;
};

const s = (score: number, unknown?: boolean) =>
  unknown ? "N/A  " : `${score}/10`;

export function buildScorecardText(
  evaluation: Evaluation,
  listing: Listing,
  notableFlags: string[],
  commuteMinutes: number,
  unknownScores: UnknownScores = {},
): string {
  const allFlags = [...(evaluation.deal_breaker_flags || []), ...notableFlags];

  const watchOuts =
    allFlags.length > 0
      ? allFlags.map((f) => `• ${f}`).join("\n  ")
      : "• None identified";

  const commuteLabel = unknownScores.commute
    ? "N/A  "
    : `${evaluation.commute_score}/10 (${commuteMinutes} min)`;

  const title = listing.title || "Untitled property";
  const urlLine = listing.url
    ? `[🔗 View listing](${listing.url})`
    : "🔗 No link";

  const scorecardText = `🏠 **${title}**
  --------------------------------------
  £${listing.price?.toLocaleString()} · £${evaluation.monthly_mortgage}/mo

✅ Score:                         ${s(evaluation.overall_score)}
  --------------------------------------
  Property fit:                       ${s(evaluation.fit_score, unknownScores.property)}
  Size:                                   ${s(evaluation.size_score, unknownScores.property)}
  Area:                                  ${s(evaluation.area_score, unknownScores.area)}
  Commute:                         ${commuteLabel}
  Value:                                 ${s(evaluation.price_score, unknownScores.property)}  
  --------------------------------------

⚠️ Watch outs
  ${watchOuts}

${urlLine}`;
  return scorecardText;
}

export function buildNoScoreScorecardText(
  _evaluation: Evaluation,
  listing: Listing,
): string {
  const title = listing.title || "Untitled property";
  const urlLine = listing.url
    ? `[🔗 View listing](${listing.url})`
    : "Listing URL unavailable";

  const scorecardText = `🏠 ${title}
💰 £${listing.price?.toLocaleString()}

No score
  This property couldn't be evaluated — not enough data to score it against your preferences.

${urlLine}`;
  return scorecardText;
}
