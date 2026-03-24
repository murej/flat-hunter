import { normalizePortalId } from "./portal-id";
import { reportError } from "@/lib/core/reporting";
import type { ListingOutput } from "@/lib/schemas";

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const MAX_PRICE = 50_000_000;

type ValidatedListing = {
  listing: ListingOutput;
  flags: string[];
};

export async function validateAndCleanListings(
  listings: ListingOutput[],
): Promise<ValidatedListing[]> {
  const results: ValidatedListing[] = [];

  for (const listing of listings) {
    const result = validateOne(listing);
    if (!result) {
      await reportError(
        new Error(`Listing dropped: title="${listing.title}" portal_id="${listing.portal_id}"`),
        { source: "ingest/validation" },
      );
      continue;
    }
    results.push(result);
  }

  return results;
}

function validateOne(listing: ListingOutput): ValidatedListing | null {
  const flags: string[] = [];
  let { url, price, postcode, title, portal_id } = listing;

  // Title required
  if (!title?.trim()) return null;

  // Price must be positive
  if (price <= 0) return null;
  if (price > MAX_PRICE) flags.push("price_suspect");

  // URL normalization
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
    flags.push("url_prefixed");
  }
  if (!url) flags.push("url_missing");

  // Postcode normalization
  if (UK_POSTCODE.test(postcode)) {
    // Normalize: uppercase, single space before inward code
    const clean = postcode.toUpperCase().replace(/\s+/g, "");
    postcode = `${clean.slice(0, -3)} ${clean.slice(-3)}`;
  } else {
    flags.push("postcode_invalid");
  }

  // Normalize portal_id
  portal_id = normalizePortalId({ portal_id, url, postcode });

  return {
    listing: { ...listing, url, price, postcode, title, portal_id },
    flags,
  };
}
