import { nominatimThrottle } from "@/lib/utils/retry";

const API_TIMEOUT = 8000;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export type GeocodedAddress = {
  lat: number;
  lon: number;
  /** Full UK postcode if Nominatim returned one and it passed validation. */
  postcode?: string;
};

/**
 * Strip flat/apartment/unit/plot prefixes that confuse Nominatim.
 * E.g. "Flat 3A, 10 Church Street, London" → "10 Church Street, London"
 */
export function simplifyAddress(address: string): string {
  return address
    .replace(/^(apartment|flat|unit|plot|suite)\s*-?\s*\w+,?\s*/i, "")
    .trim();
}

/**
 * Geocode a free-form UK address via Nominatim (OpenStreetMap).
 *
 * Returns lat/lon and, when available, a validated full UK postcode.
 * Returns null on any network or parse error — never throws.
 *
 * Rate-limited to 1 req/s globally via nominatimThrottle.
 */
export async function geocodeAddress(
  address: string,
): Promise<GeocodedAddress | null> {
  return nominatimThrottle(async () => {
    try {
      const simplified = simplifyAddress(address);
      const query = simplified !== address ? simplified : address;

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
        {
          headers: { "User-Agent": "Stath/1.0" },
          signal: AbortSignal.timeout(API_TIMEOUT),
        },
      );

      if (!res.ok) {
        console.error("[geocode] Nominatim failed for", query, "status:", res.status);
        return null;
      }

      const results = (await res.json()) as Array<{
        lat: string;
        lon: string;
        address?: { postcode?: string };
      }>;

      if (!results[0]) {
        console.error("[geocode] Nominatim returned no results for", query);
        return null;
      }

      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);

      const rawPostcode = results[0].address?.postcode;
      const postcode =
        rawPostcode && UK_POSTCODE.test(rawPostcode) ? rawPostcode : undefined;

      return { lat, lon, postcode };
    } catch (err) {
      console.error("[geocode] Nominatim error for", address, err);
      return null;
    }
  });
}

/**
 * Returns the outward code (district) from a postcode or partial postcode.
 * E.g. "N7 9GU" → "N7", "N7" → "N7", "" → null
 */
export function extractOutwardCode(postcode: string): string | null {
  const trimmed = postcode.trim().toUpperCase();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * Checks whether a full geocoded postcode is consistent with the outward code
 * already stored on the listing. Returns true if:
 * - The stored outward code is empty (no constraint)
 * - The geocoded postcode starts with the stored outward code
 */
export function passesOutwardCheck(
  storedPostcode: string,
  geocodedPostcode: string,
): boolean {
  const outward = extractOutwardCode(storedPostcode);
  if (!outward) return true; // no stored code to check against
  return geocodedPostcode.toUpperCase().startsWith(outward);
}
