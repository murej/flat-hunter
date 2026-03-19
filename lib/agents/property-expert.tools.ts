import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";

export const PROPERTY_EXPERT_TOOL_SETS: ToolSet[] = ["db", "web_search"];

export function buildPropertyExpertTools() {
  return buildTools(PROPERTY_EXPERT_TOOL_SETS);
}

export function createPropertyExpertExecuteTool() {
  return createExecuteTool(PROPERTY_EXPERT_TOOL_SETS);
}
