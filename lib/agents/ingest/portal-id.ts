const PORTAL_ID_EXTRACTORS: Array<{ portal: string; pattern: RegExp }> = [
  { portal: "rightmove", pattern: /rightmove\.co\.uk\/properties\/(\d+)/ },
  { portal: "zoopla", pattern: /zoopla\.co\.uk\/(?:for-sale|to-rent)\/details\/(\d+)/ },
  { portal: "onthemarket", pattern: /onthemarket\.com\/details\/(\d+)/ },
  { portal: "primelocation", pattern: /primelocation\.com\/(?:for-sale|to-rent)\/details\/(\d+)/ },
];

const VALID_PORTAL_ID = /^(rightmove|zoopla|onthemarket|primelocation)-\d+$/;

export function extractPortalIdFromUrl(url: string): string | null {
  for (const { portal, pattern } of PORTAL_ID_EXTRACTORS) {
    const match = url.match(pattern);
    if (match) return `${portal}-${match[1]}`;
  }
  return null;
}

export function normalizePortalId(listing: {
  portal_id: string;
  url: string;
  postcode: string;
}): string {
  // 1. Try extracting deterministically from URL
  const fromUrl = extractPortalIdFromUrl(listing.url);
  if (fromUrl) return fromUrl;

  // 2. If LLM already produced a valid portal-digits ID, keep it
  if (VALID_PORTAL_ID.test(listing.portal_id)) return listing.portal_id;

  // 3. Normalize the LLM's fallback ID (uppercase postcode, no spaces)
  const normalizedPostcode = listing.postcode.toUpperCase().replace(/\s+/g, "");
  const parts = listing.portal_id.split("-");
  if (parts.length >= 3) {
    // Replace postcode portion with normalized version
    return `${parts[0]}-${normalizedPostcode}-${parts.slice(2).join("-")}`;
  }

  return listing.portal_id;
}

export function annotateUrlWithPortalId(url: string): string {
  const id = extractPortalIdFromUrl(url);
  return id ? `${url} [portal_id: ${id}]` : url;
}
