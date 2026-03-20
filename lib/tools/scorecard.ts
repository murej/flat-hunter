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
): string {
  const lines = [
    `🏠 *${listing.title}*`,
    `📍 ${listing.address}`,
    `💰 ${formatMoney(listing.price)}`,
    `🛏 ${listing.bedrooms} bed | 🛁 ${listing.bathrooms} bath${listing.sqft ? ` | 📐 ${listing.sqft} sqft` : ""}`,
    "",
    `*Overall: ${evaluation.overall_score}/10*`,
    "",
    `Fit:     ${scoreBar(evaluation.fit_score)} ${evaluation.fit_score}/10`,
    `Price:   ${scoreBar(evaluation.price_score)} ${evaluation.price_score}/10`,
    `Size:    ${scoreBar(evaluation.size_score)} ${evaluation.size_score}/10`,
    `Area:    ${scoreBar(evaluation.area_score)} ${evaluation.area_score}/10`,
    `Commute: ${scoreBar(evaluation.commute_score)} ${evaluation.commute_score}/10`,
  ];

  if (evaluation.commute_minutes !== null) {
    lines.push(`🚇 ${evaluation.commute_minutes} min — ${evaluation.commute_route}`);
  }

  if (evaluation.total_monthly !== null) {
    lines.push(`💷 ${formatMoney(evaluation.total_monthly)}/mo (mortgage + service)`);
  }

  if (evaluation.deal_breaker_flags.length > 0) {
    lines.push(`\n⚠️ Deal breakers: ${evaluation.deal_breaker_flags.join(", ")}`);
  }

  lines.push(`\n${evaluation.property_summary}`);
  lines.push(`\n📌 ${evaluation.area_summary}`);

  if (listing.url) {
    lines.push(`\n🔗 ${listing.url}`);
  }

  return lines.join("\n");
}

export function buildScorecardButtons(
  listingId: number,
  isSaved: boolean,
): Array<Array<{ text: string; callback_data: string }>> {
  return [
    [
      isSaved
        ? { text: "📌 Unsave", callback_data: `unsave:${listingId}` }
        : { text: "💾 Save", callback_data: `save:${listingId}` },
      { text: "⏭ Skip", callback_data: `skip:${listingId}` },
      { text: "❓ Why?", callback_data: `why:${listingId}` },
    ],
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
