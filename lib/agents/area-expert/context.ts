const MAX_TARGET_AREAS = 12;
const MAX_AREA_PREFERENCES = 15;
const MAX_PROFILE_AREAS = 6;
const MAX_NOTE_CHARS = 400;
const TOP_CRIME_CATEGORIES = 10;

function truncateStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function slimPostcode(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    admin_district: raw.admin_district,
    admin_ward: raw.admin_ward,
    region: raw.region,
    latitude: raw.latitude,
    longitude: raw.longitude,
  };
}

function slimCrime(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const byCategory = raw.by_category as Record<string, number> | undefined;
  let top: Record<string, number> | undefined;
  if (byCategory && typeof byCategory === "object") {
    const entries = Object.entries(byCategory)
      .filter(([, n]) => typeof n === "number")
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CRIME_CATEGORIES);
    top = Object.fromEntries(entries);
  }
  return {
    total: raw.total,
    months_covered: raw.months_covered,
    ...(top && Object.keys(top).length > 0 ? { by_category_top: top } : {}),
  };
}

function slimImd(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    rank: raw.rank,
    total_lsoas: raw.total_lsoas,
    decile: raw.decile,
  };
}

function slimAreaProfileValue(
  v: unknown,
): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return {
    crime_notes: truncateStr(String(o.crime_notes ?? ""), MAX_NOTE_CHARS),
    amenities_notes: truncateStr(String(o.amenities_notes ?? ""), MAX_NOTE_CHARS),
    character_notes: truncateStr(String(o.character_notes ?? ""), MAX_NOTE_CHARS),
    flood_risk_notes: truncateStr(String(o.flood_risk_notes ?? ""), MAX_NOTE_CHARS),
    transport_notes: truncateStr(String(o.transport_notes ?? ""), MAX_NOTE_CHARS),
  };
}

function slimPreferredProfiles(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(raw).slice(0, MAX_PROFILE_AREAS);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const slim = slimAreaProfileValue(raw[k]);
    if (slim) out[k] = slim;
  }
  return out;
}

/**
 * Compact area context for the area expert LLM prompt (smaller than full pipeline blob).
 */
export function slimAreaContextForExpert(
  areaContext: Record<string, unknown>,
): Record<string, unknown> {
  const targetAreas = Array.isArray(areaContext.target_areas)
    ? (areaContext.target_areas as unknown[]).filter((x) => typeof x === "string")
    : [];
  const areaPrefs = Array.isArray(areaContext.area_preferences)
    ? (areaContext.area_preferences as unknown[]).filter((x) => typeof x === "string")
    : [];
  const profilesRaw = areaContext.preferred_area_profiles;
  const profiles =
    profilesRaw && typeof profilesRaw === "object" && !Array.isArray(profilesRaw)
      ? slimPreferredProfiles(profilesRaw as Record<string, unknown>)
      : {};

  const postcode = slimPostcode(
    areaContext.postcode as Record<string, unknown> | null | undefined,
  );

  return {
    postcode,
    target_area_match: areaContext.target_area_match,
    target_areas: targetAreas.slice(0, MAX_TARGET_AREAS),
    area_preferences: areaPrefs.slice(0, MAX_AREA_PREFERENCES),
    crime: slimCrime(areaContext.crime as Record<string, unknown> | null),
    imd: slimImd(areaContext.imd as Record<string, unknown> | null),
    preferred_area_profiles: profiles,
  };
}

