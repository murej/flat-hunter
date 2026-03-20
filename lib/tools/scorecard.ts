import type { Evaluation, Listing } from "@/types";

/** Telegram HTML parse mode: escape text outside tags. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** href value for <a> — quote and ampersand per Telegram HTML rules. */
function escHref(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

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

  const commuteLabel = unknownScores.commute
    ? "N/A  "
    : `${evaluation.commute_score}/10 (${commuteMinutes} min)`;

  const hasUnknown = !!(
    unknownScores.property ||
    unknownScores.area ||
    unknownScores.commute
  );
  const overallLabel = `${evaluation.overall_score}/10${hasUnknown ? "*" : ""}`;

  const title = esc(listing.title || "Untitled property");
  const urlLine = listing.url
    ? `<a href="${escHref(listing.url)}">🔗 View listing</a>`
    : "🔗 No link";

  const watchOutsHtml =
    allFlags.length > 0
      ? allFlags.map((f) => `• ${esc(f)}`).join("\n  ")
      : "• None identified";

  const scorecardText = `🏠 <b>${title}</b>
  --------------------------------------
  £${listing.price?.toLocaleString()} · £${evaluation.monthly_mortgage}/mo

✅ Score:                         ${overallLabel}
  --------------------------------------
  Property fit:                       ${s(evaluation.fit_score, unknownScores.property)}
  Size:                                   ${s(evaluation.size_score, unknownScores.property)}
  Area:                                  ${s(evaluation.area_score, unknownScores.area)}
  Commute:                         ${commuteLabel}
  Value:                                 ${s(evaluation.price_score, unknownScores.property)}  
  --------------------------------------

⚠️ Watch outs
  ${watchOutsHtml}

${urlLine}`;
  return scorecardText;
}

export function buildNoScoreScorecardText(
  _evaluation: Evaluation,
  listing: Listing,
): string {
  const title = esc(listing.title || "Untitled property");
  const urlLine = listing.url
    ? `<a href="${escHref(listing.url)}">🔗 View listing</a>`
    : "Listing URL unavailable";

  const scorecardText = `🏠 ${title}
💰 £${listing.price?.toLocaleString()}

No score
  This property couldn't be evaluated — not enough data to score it against your preferences.

${urlLine}`;
  return scorecardText;
}
