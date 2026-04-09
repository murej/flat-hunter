import type { Listing, Preferences } from "@/types";

type AreaContextResult = Awaited<
  ReturnType<(typeof import("@/lib/tools/area"))["fetchAreaContext"]>
>;

export function buildPropertyPrompt(listing: Listing, preferences: Preferences): string {
  const desc =
    listing.description.length > 2000
      ? listing.description.slice(0, 2000) + "..."
      : listing.description;

  // Build tenure string e.g. "Leasehold (85 years remaining)" or "Freehold"
  const tenureStr = listing.tenure
    ? listing.tenure === "Leasehold" && listing.lease_length_years
      ? `Leasehold (${listing.lease_length_years} years remaining)`
      : listing.tenure
    : null;

  // Key facts lines — only emit when data is present
  const keyFactParts: string[] = [];
  if (listing.property_type) keyFactParts.push(`Type: ${listing.property_type}`);
  if (tenureStr)             keyFactParts.push(`Tenure: ${tenureStr}`);
  if (listing.epc_rating)    keyFactParts.push(`EPC: ${listing.epc_rating}`);
  if (listing.council_tax_band) keyFactParts.push(`Council tax: Band ${listing.council_tax_band}`);

  const keyFactsSection = keyFactParts.length > 0 || (listing.key_features?.length ?? 0) > 0
    ? `\n**Key facts:**\n${keyFactParts.length > 0 ? `- ${keyFactParts.join(" | ")}\n` : ""}${listing.key_features?.length ? `- Key features: ${listing.key_features.join(", ")}` : ""}`
    : "";

  return `Evaluate this property against the buyer's preferences.

**Property:**
- Title: ${listing.title}
- Price: £${listing.price.toLocaleString("en-GB")}
- Address: ${listing.address} (${listing.postcode})
- Bedrooms: ${listing.bedrooms} | Bathrooms: ${listing.bathrooms}${listing.sqft ? ` | Sqft: ${listing.sqft}` : ""}
- Description: ${desc}${keyFactsSection}

**Buyer preferences:**
- Max price: £${preferences.max_price.toLocaleString("en-GB")}
- Min bedrooms: ${preferences.min_bedrooms}
- Must-haves: ${preferences.must_haves.join(", ") || "None specified"}
- Deal-breakers: ${preferences.deal_breakers.join(", ") || "None specified"}
- Style: ${preferences.style_notes || "No style preference"}
- Notes: ${preferences.freeform_notes || "None"}`;
}

export function buildAreaPrompt(
  listing: Listing,
  preferences: Preferences,
  areaContext: AreaContextResult,
): string {
  return `Evaluate the area around ${listing.address} (${listing.postcode}).

**Buyer preferences:**
- Interested areas: ${preferences.areas.join(", ")}
${preferences.area_preferences?.length ? `- Area preferences: ${preferences.area_preferences.join(", ")}` : ""}
- Must-haves: ${preferences.must_haves.join(", ") || "None specified"}
- Deal-breakers: ${preferences.deal_breakers.join(", ") || "None specified"}
- Style: ${preferences.style_notes || "No style preference"}
- Notes: ${preferences.freeform_notes || "None"}

${areaContext ? `Pre-fetched area data is provided separately.` : "No pre-fetched area data available. Use database tools to check for existing area profiles."}`;
}
