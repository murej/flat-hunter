import type { ToolSet } from "@/lib/core/tools";
import { envBool, envIntClamped } from "@/lib/config/env-utils";

/** Default true — preserves existing behaviour when unset. */
export function getPropertyExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (
    envBool(
      process.env.PROPERTY_EXPERT_WEB_SEARCH,
      true,
      "PROPERTY_EXPERT_WEB_SEARCH",
    )
  ) {
    sets.push("web_search");
  }
  return sets;
}

/** Default true — set AREA_EXPERT_WEB_SEARCH=false in production to cut search cost. */
export function getAreaExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (
    envBool(process.env.AREA_EXPERT_WEB_SEARCH, true, "AREA_EXPERT_WEB_SEARCH")
  ) {
    sets.push("web_search");
  }
  return sets;
}

/**
 * Assistant turns including the final JSON-only turn after tools.
 * Default 8 — db_read → db_write → optional web_search → final JSON needs headroom
 * (default 3 caused frequent "Max tool iterations reached" in logs).
 * Clamped 1–12.
 */
export function getExpertMaxToolIterations(): number {
  return envIntClamped(
    process.env.EXPERT_MAX_TOOL_ITERATIONS,
    8,
    1,
    12,
    "EXPERT_MAX_TOOL_ITERATIONS",
  );
}
