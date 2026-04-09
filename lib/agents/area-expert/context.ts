type AreaContextData = {
  postcode: {
    admin_ward: string;
    parish: string;
    lsoa: string;
    msoa: string;
    region: string;
  };
  crime: unknown[];
  imd: unknown | null;
  matchedArea: string | null;
};

export function isValidAreaContext(data: unknown): data is AreaContextData {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.postcode !== "object" || obj.postcode === null) return false;
  const pc = obj.postcode as Record<string, unknown>;
  return typeof pc.admin_ward === "string";
}

export function slimAreaContext(ctx: AreaContextData): Record<string, unknown> {
  // Trim crime data — just counts by category
  const crimeCounts: Record<string, number> = {};
  if (Array.isArray(ctx.crime)) {
    for (const c of ctx.crime as Array<{ category?: string }>) {
      const cat = c.category ?? "unknown";
      crimeCounts[cat] = (crimeCounts[cat] || 0) + 1;
    }
  }

  // Extract only the 4 decile scores from the raw ArcGIS IMD response.
  // Deciles run 1 (most deprived) to 10 (least deprived).
  const imdRaw = ctx.imd as Record<string, unknown> | null;
  const imd = imdRaw
    ? {
        overall_decile: imdRaw.IMDDecile,
        income_decile: imdRaw.IncDecile,
        crime_decile: imdRaw.CriDecile,
        living_env_decile: imdRaw.LEDDecile,
      }
    : null;

  return {
    ward: ctx.postcode.admin_ward,
    region: ctx.postcode.region,
    matchedArea: ctx.matchedArea,
    crimeSummary: crimeCounts,
    totalCrimes: Array.isArray(ctx.crime) ? ctx.crime.length : 0,
    imd,
  };
}
