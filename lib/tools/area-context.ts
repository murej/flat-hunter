import Anthropic from "@anthropic-ai/sdk";
import { retryWithBackoff } from "@/lib/utils/retry";
import { AREA_PROFILE_EVALUATOR_SYSTEM } from "@/lib/prompts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const fullPostcodeRe = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const outwardCodeRe = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export interface AreaProfile {
  area_name: string;
  postcode_used: string | null;
  crime_notes: string;
  amenities_notes: string;
  character_notes: string;
  flood_risk_notes: string;
  transport_notes: string;
}

export interface PostcodeContext {
  admin_district: string | null;
  admin_ward: string | null;
  admin_county: string | null;
  region: string | null;
  country: string | null;
  parish: string | null;
  ruc11: string | null;
  bua: string | null;
  ttwa: string | null;
  lsoa: string | null;
  lsoa_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CrimeContext {
  total: number;
  months_covered: number;
  by_category: Record<string, number>;
}

export interface IMDContext {
  rank: number;
  total_lsoas: number;
  decile: number;
}

export interface AreaContext {
  postcode: PostcodeContext | null;
  target_area_match: boolean | null;
  target_areas: string[];
  crime: CrimeContext | null;
  imd: IMDContext | null;
  postcode_resolved: boolean;
  crime_available: boolean;
  imd_available: boolean;
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

const CRIME_API = "https://data.police.uk/api/crimes-street/all-crime";
const IMD_TOTAL_LSOAS = 32_844;
const IMD_ARCGIS =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Index_of_Multiple_Deprivation_Dec_2019_Lookup_in_England_2022/FeatureServer/0/query";

function getLastMonths(count: number): string[] {
  const months: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

async function fetchCrimeData(
  lat: number,
  lng: number,
): Promise<CrimeContext | null> {
  const months = getLastMonths(3);
  const byCategory: Record<string, number> = {};
  let total = 0;

  const results = await Promise.all(
    months.map(async (date) => {
      try {
        const res = await retryWithBackoff(async () => {
          const r = await fetch(
            `${CRIME_API}?lat=${lat}&lng=${lng}&date=${date}`,
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r;
        });
        return (await res.json()) as Array<{ category?: string }>;
      } catch {
        return [] as Array<{ category?: string }>;
      }
    }),
  );

  for (const crimes of results) {
    for (const c of crimes) {
      const cat = c.category ?? "other";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      total++;
    }
  }

  return {
    total,
    months_covered: results.filter((r) => r.length > 0).length,
    by_category: byCategory,
  };
}

async function fetchImdData(lsoaCode: string): Promise<IMDContext | null> {
  if (!lsoaCode || lsoaCode.length < 9) return null;

  try {
    const url = new URL(IMD_ARCGIS);
    url.searchParams.set("where", `LSOA11CD='${lsoaCode.replace(/'/g, "''")}'`);
    url.searchParams.set("outFields", "IMD19");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("f", "json");

    const res = await retryWithBackoff(async () => {
      const r = await fetch(url.toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    const data = await res.json();
    const feature = data?.features?.[0];
    const rank = feature?.attributes?.IMD19;
    if (typeof rank !== "number" || rank < 1 || rank > IMD_TOTAL_LSOAS)
      return null;

    const decile = Math.ceil((rank / IMD_TOTAL_LSOAS) * 10);
    return {
      rank,
      total_lsoas: IMD_TOTAL_LSOAS,
      decile: Math.min(decile, 10),
    };
  } catch {
    return null;
  }
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
  let postcode_resolved = false;

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
          country: r.country ?? null,
          parish: r.parish ?? null,
          ruc11: r.ruc11 ?? null,
          bua: r.bua ?? null,
          ttwa: r.ttwa ?? null,
          lsoa: r.lsoa ?? null,
          lsoa_code: r.codes?.lsoa ?? null,
          latitude: typeof r.latitude === "number" ? r.latitude : null,
          longitude: typeof r.longitude === "number" ? r.longitude : null,
        };
        postcode_resolved = true;
      }
    } catch {
      // Fall through with null context
    }
  }

  let crime: CrimeContext | null = null;
  let imd: IMDContext | null = null;
  let crime_available = false;
  let imd_available = false;
  if (
    postcodeContext?.latitude != null &&
    postcodeContext?.longitude != null
  ) {
    try {
      crime = await fetchCrimeData(
        postcodeContext.latitude,
        postcodeContext.longitude,
      );
      if (crime && crime.total >= 0 && crime.months_covered >= 0) {
        crime_available = true;
      }
    } catch (e) {
      console.error("Failed to fetch crime data:", e);
    }
  }

  if (postcodeContext?.lsoa_code && postcodeContext?.country === "England") {
    try {
      imd = await fetchImdData(postcodeContext.lsoa_code);
      if (imd && imd.decile >= 1 && imd.decile <= 10) {
        imd_available = true;
      }
    } catch (e) {
      console.error("Failed to fetch IMD data:", e);
    }
  }

  const target_area_match = computeTargetAreaMatch(postcodeContext, targetAreas);

  return {
    postcode: postcodeContext,
    target_area_match,
    target_areas: targetAreas,
    crime,
    imd,
    postcode_resolved,
    crime_available,
    imd_available,
  };
}

async function resolveAreaToPostcode(areaName: string): Promise<string | null> {
  const trimmed = areaName.trim();
  if (!trimmed) return null;

  try {
    const res = await retryWithBackoff(async () => {
      const r = await fetch(
        `https://api.postcodes.io/places?q=${encodeURIComponent(trimmed)}&limit=1`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    const data = await res.json();
    const place = data?.result?.[0];
    if (!place?.latitude || !place?.longitude) return null;

    const geoRes = await retryWithBackoff(async () => {
      const r = await fetch(
        `https://api.postcodes.io/postcodes?lon=${place.longitude}&lat=${place.latitude}&limit=1`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    const geoData = await geoRes.json();
    const postcode = geoData?.result?.[0]?.postcode as string | undefined;
    return postcode ?? null;
  } catch {
    return null;
  }
}

export async function evaluateAreaProfile(areaName: string): Promise<AreaProfile | null> {
  const postcode = await resolveAreaToPostcode(areaName);
  let postcodeContext: PostcodeContext | null = null;

  if (postcode) {
    try {
      const res = await retryWithBackoff(async () => {
        const r = await fetch(
          `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ""))}`,
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
          country: r.country ?? null,
          parish: r.parish ?? null,
          ruc11: r.ruc11 ?? null,
          bua: r.bua ?? null,
          ttwa: r.ttwa ?? null,
          lsoa: r.lsoa ?? null,
          lsoa_code: r.codes?.lsoa ?? null,
          latitude: typeof r.latitude === "number" ? r.latitude : null,
          longitude: typeof r.longitude === "number" ? r.longitude : null,
        };
      }
    } catch {
      // Fall through
    }
  }

  const response = await retryWithBackoff(() =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: AREA_PROFILE_EVALUATOR_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Area: ${areaName}\n\nPostcode context: ${JSON.stringify(postcodeContext ?? { note: "No postcode data available" }, null, 2)}`,
        },
      ],
    }),
  );

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      area_name: areaName,
      postcode_used: postcode ?? null,
      crime_notes: parsed.crime_notes ?? "",
      amenities_notes: parsed.amenities_notes ?? "",
      character_notes: parsed.character_notes ?? "",
      flood_risk_notes: parsed.flood_risk_notes ?? "",
      transport_notes: parsed.transport_notes ?? "",
    };
  } catch {
    return null;
  }
}

export async function evaluatePreferredAreas(
  areaNames: string[],
): Promise<Record<string, AreaProfile>> {
  const results = await Promise.all(
    areaNames.map(async (name) => {
      const profile = await evaluateAreaProfile(name);
      return { name, profile };
    }),
  );

  const profiles: Record<string, AreaProfile> = {};
  for (const { name, profile } of results) {
    if (profile) profiles[name] = profile;
  }
  return profiles;
}
