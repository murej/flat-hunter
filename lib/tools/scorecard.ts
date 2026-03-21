import type { Listing, Evaluation } from "@/types";

function scoreBar(score: number): string {
  const filled = Math.round(score);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatMoney(n: number | null): string {
  if (n === null) return "N/A";
  return `£${n.toLocaleString("en-GB")}`;
}

export function buildScorecardText(
  listing: Listing,
  evaluation: Evaluation,
  mortgageRate?: number,
): string {
  let priceLine = `💰 ${formatMoney(listing.price)}`;
  if (evaluation.mortgage_monthly !== null && mortgageRate != null) {
    priceLine += ` · ${formatMoney(evaluation.mortgage_monthly)}/mo (${mortgageRate}%)`;
  }

  const lines = [
    `🏠 *${listing.title}*`,
    `📍 ${listing.address}`,
    priceLine,
    `🛏 ${listing.bedrooms} bed | 🛁 ${listing.bathrooms} bath${listing.sqft ? ` | 📐 ${Math.round(listing.sqft / 10.764)} m²` : ""}`,
    "",
    `*Overall: ${evaluation.overall_score}/10*`,
    "",
    `Fit:     ${scoreBar(evaluation.fit_score)} ${evaluation.fit_score}/10`,
    `Price:   ${scoreBar(evaluation.price_score)} ${evaluation.price_score}/10`,
    `Size:    ${scoreBar(evaluation.size_score)} ${evaluation.size_score}/10`,
    `Area:    ${scoreBar(evaluation.area_score)} ${evaluation.area_score}/10`,
    `Commute: ${scoreBar(evaluation.commute_score)} ${evaluation.commute_score}/10${evaluation.commute_minutes != null ? ` · ${evaluation.commute_minutes} min` : ""}`,
  ];

  lines.push("", evaluation.property_summary);

  if (listing.url) {
    lines.push(`\n🔗 ${listing.url}`);
  }

  return lines.join("\n");
}

export function buildScorecardButtons(
  listingId: string,
): Array<Array<{ text: string; callback_data: string }>> {
  return [
    [{ text: "More details", callback_data: `why:${listingId}` }],
  ];
}

export function buildNoScoreScorecardText(listing: Listing): string {
  return [
    `🏠 *${listing.title}*`,
    `📍 ${listing.address}`,
    `💰 ${formatMoney(listing.price)}`,
    `🛏 ${listing.bedrooms} bed | 🛁 ${listing.bathrooms} bath`,
    "",
    "⏳ Evaluation pending...",
    "",
    listing.url ? `🔗 ${listing.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
