import type { Listing, Preferences } from "@/types";

type AreaContextResult = Awaited<
  ReturnType<(typeof import("@/lib/tools/area"))["fetchAreaContext"]>
>;

export function buildPropertyPrompt(listing: Listing, preferences: Preferences): string {
  const desc =
    listing.description.length > 2000
      ? listing.description.slice(0, 2000) + "..."
      : listing.description;

  return `Evaluate this property against the buyer's preferences.

**Property:**
- Title: ${listing.title}
- Price: £${listing.price.toLocaleString("en-GB")}
- Address: ${listing.address} (${listing.postcode})
- Bedrooms: ${listing.bedrooms} | Bathrooms: ${listing.bathrooms}${listing.sqft ? ` | Sqft: ${listing.sqft}` : ""}
- Description: ${desc}

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
  return `Evaluate the area around ${listing.address} (${listing.postcode}) for a buyer interested in: ${preferences.areas.join(", ")}.

${preferences.area_preferences?.length ? `Area preferences: ${preferences.area_preferences.join(", ")}` : ""}

${areaContext ? `Pre-fetched area data is provided separately.` : "No pre-fetched area data available. Use database tools to check for existing area profiles."}

Read the buyer's preferences from the database for full context.`;
}
