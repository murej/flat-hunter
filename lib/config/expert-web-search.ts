import { envBool } from "@/lib/utils/env-utils";
import type { ToolSet } from "@/lib/core/tools";

export const EXPERT_MAX_STEPS = 8;

export function getPropertyExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (envBool("PROPERTY_EXPERT_WEB_SEARCH")) sets.push("web_search");
  return sets;
}

export function getAreaExpertToolSets(): ToolSet[] {
  const sets: ToolSet[] = ["db"];
  if (envBool("AREA_EXPERT_WEB_SEARCH")) sets.push("web_search");
  return sets;
}
