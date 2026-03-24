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

  return {
    ward: ctx.postcode.admin_ward,
    parish: ctx.postcode.parish,
    lsoa: ctx.postcode.lsoa,
    msoa: ctx.postcode.msoa,
    region: ctx.postcode.region,
    matchedArea: ctx.matchedArea,
    crimeSummary: crimeCounts,
    totalCrimes: ctx.crime.length,
    imd: ctx.imd,
  };
}
