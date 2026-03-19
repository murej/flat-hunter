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

/** Clamped 1–5. Default 3. */
export function getExpertMaxToolIterations(): number {
  return envIntClamped(
    process.env.EXPERT_MAX_TOOL_ITERATIONS,
    3,
    1,
    5,
    "EXPERT_MAX_TOOL_ITERATIONS",
  );
}
