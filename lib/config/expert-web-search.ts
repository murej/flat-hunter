import type { ToolSet } from "@/lib/core/tools";

function envBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return defaultValue;
}

function envIntClamped(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

/** Default true — preserves existing behaviour when unset. */
export function getPropertyExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (envBool(process.env.PROPERTY_EXPERT_WEB_SEARCH, true)) {
    sets.push("web_search");
  }
  return sets;
}

/** Default true — set AREA_EXPERT_WEB_SEARCH=false in production to cut search cost. */
export function getAreaExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (envBool(process.env.AREA_EXPERT_WEB_SEARCH, true)) {
    sets.push("web_search");
  }
  return sets;
}

/** Clamped 1–5. Default 3. */
export function getExpertMaxToolIterations(): number {
  return envIntClamped(process.env.EXPERT_MAX_TOOL_ITERATIONS, 3, 1, 5);
}
