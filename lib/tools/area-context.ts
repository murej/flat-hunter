import { retryWithBackoff } from "@/lib/utils/retry";

const fullPostcodeRe = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const outwardCodeRe = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export interface PostcodeContext {
  admin_district: string | null;
  admin_ward: string | null;
  admin_county: string | null;
  region: string | null;
  parish: string | null;
  ruc11: string | null;
  bua: string | null;
  ttwa: string | null;
  lsoa: string | null;
}

export interface AreaContext {
  postcode: PostcodeContext | null;
  target_area_match: boolean | null;
  target_areas: string[];
}

async function resolveToFullPostcode(
  postcode: string,
  address?: string,
): Promise<string | null> {
  const trimmed = postcode.trim();
  if (!trimmed) return null;

  if (fullPostcodeRe.test(trimmed)) {
    return trimmed.replace(/\s+/g, "");
  }

  if (outwardCodeRe.test(trimmed)) {
    try {
      const res = await retryWithBackoff(async () => {
        const r = await fetch(
          `https://api.postcodes.io/postcodes?q=${encodeURIComponent(trimmed)}&limit=1`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r;
      });
      const data = await res.json();
      const first = data?.result?.[0]?.postcode as string | undefined;
      return first ? first.replace(/\s+/g, "") : null;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function computeTargetAreaMatch(
  postcodeContext: PostcodeContext | null,
  targetAreas: string[],
): boolean | null {
  if (!targetAreas.length) return null;
  if (!postcodeContext) return null;

  const listingStrings = [
    postcodeContext.admin_district,
    postcodeContext.admin_ward,
    postcodeContext.parish,
    postcodeContext.bua,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map(normalizeForMatch);

  if (listingStrings.length === 0) return null;

  for (const target of targetAreas) {
    const t = normalizeForMatch(target);
    if (!t) continue;
    for (const listing of listingStrings) {
      if (listing.includes(t) || t.includes(listing)) return true;
    }
  }

  return false;
}

export async function fetchAreaContext(
  postcode: string,
  targetAreas: string[],
  address?: string,
): Promise<AreaContext> {
  const fullPostcode = await resolveToFullPostcode(postcode, address);
  let postcodeContext: PostcodeContext | null = null;

  if (fullPostcode) {
    try {
      const res = await retryWithBackoff(async () => {
        const r = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(fullPostcode)}`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r;
      });
      const data = await res.json();
      const r = data?.result;
      if (r) {
        postcodeContext = {
          admin_district: r.admin_district ?? null,
          admin_ward: r.admin_ward ?? null,
          admin_county: r.admin_county ?? null,
          region: r.region ?? null,
          parish: r.parish ?? null,
          ruc11: r.ruc11 ?? null,
          bua: r.bua ?? null,
          ttwa: r.ttwa ?? null,
          lsoa: r.lsoa ?? null,
        };
      }
    } catch {
      // Fall through with null context
    }
  }

  const target_area_match = computeTargetAreaMatch(postcodeContext, targetAreas);

  return {
    postcode: postcodeContext,
    target_area_match,
    target_areas: targetAreas,
  };
}
