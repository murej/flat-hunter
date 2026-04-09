import { envBool } from "@/lib/utils/env-utils";
import type { ToolSet } from "@/lib/core/tools";

export const EXPERT_MAX_STEPS = 3;
export const PROPERTY_EXPERT_MAX_STEPS = 2;

export function getPropertyExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = [];
  if (envBool("PROPERTY_EXPERT_WEB_SEARCH")) sets.push("web_search");
  return sets;
}

export function getAreaExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db_read"];
  if (envBool("AREA_EXPERT_WEB_SEARCH")) sets.push("web_search");
  return sets;
}
