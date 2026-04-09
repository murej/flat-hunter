import type { Listing, Evaluation } from "@/types";

function escapeMarkdown(s: string): string {
  return s.replace(/([_*\[\]`])/g, "\\$1");
}

function scoreBar(score: number | null): string {
  if (score == null) return "N/A";
  const filled = Math.min(10, Math.max(0, Math.round(score)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function scoreLine(label: string, score: number | null, suffix?: string): string {
  if (score == null) return `${label} N/A`;
  return `${label} ${scoreBar(score)} ${score}/10${suffix ?? ""}`;
}

function formatMoney(n: number | null): string {
  if (n === null) return "N/A";
  return `£${n.toLocaleString("en-GB")}`;
}

export function buildScorecardText(
  listing: Listing,
  evaluation: Evaluation,
  mortgageRate?: number,
  partialScore?: boolean,
): string {
  let priceLine = `💰 ${formatMoney(listing.price)}`;
  if (evaluation.mortgage_monthly !== null && mortgageRate != null) {
    priceLine += ` · ${formatMoney(evaluation.mortgage_monthly)}/mo (${mortgageRate}%)`;
  }

  // Compact key-facts line: "Flat · Leasehold 85 yrs · EPC C · Band D"
  const factParts: string[] = [];
  if (listing.property_type) factParts.push(listing.property_type);
  if (listing.tenure) {
    const tenurePart = listing.tenure === "Leasehold" && listing.lease_length_years
      ? `Leasehold ${listing.lease_length_years} yrs`
      : listing.tenure;
    factParts.push(tenurePart);
  }
  if (listing.epc_rating)       factParts.push(`EPC ${listing.epc_rating}`);
  if (listing.council_tax_band) factParts.push(`Band ${listing.council_tax_band}`);
  const factsLine = factParts.length > 0 ? factParts.join(" · ") : null;

  const lines = [
    `🏠 *${escapeMarkdown(listing.title)}*`,
    `📍 ${escapeMarkdown(listing.address)}`,
    priceLine,
    `🛏 ${listing.bedrooms} bed | 🛁 ${listing.bathrooms} bath${listing.sqft ? ` | 📐 ${Math.round(listing.sqft / 10.764)} m²` : ""}`,
    ...(factsLine ? [escapeMarkdown(factsLine)] : []),
    "",
    `*Overall: ${evaluation.overall_score}/10${partialScore ?? [evaluation.appeal_score, evaluation.price_score, evaluation.size_score, evaluation.area_score, evaluation.commute_score].some((s) => s == null) ? "\\*" : ""}*`,
    "",
    scoreLine("Appeal: ", evaluation.appeal_score),
    scoreLine("Price:  ", evaluation.price_score),
    scoreLine("Size:   ", evaluation.size_score),
    scoreLine("Area:   ", evaluation.area_score),
    scoreLine("Commute:", evaluation.commute_score, evaluation.commute_minutes != null ? ` · ${evaluation.commute_minutes} min` : undefined),
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
    `🏠 *${escapeMarkdown(listing.title)}*`,
    `📍 ${escapeMarkdown(listing.address)}`,
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
