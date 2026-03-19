import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";

export const AREA_EXPERT_TOOL_SETS: ToolSet[] = ["db", "web_search"];

export function buildAreaExpertTools() {
  return buildTools(AREA_EXPERT_TOOL_SETS);
}

export function createAreaExpertExecuteTool() {
  return createExecuteTool(AREA_EXPERT_TOOL_SETS);
}
