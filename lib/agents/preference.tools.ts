import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";

export const PREFERENCE_TOOL_SETS: ToolSet[] = ["db"];

export function buildPreferenceTools() {
  return buildTools(PREFERENCE_TOOL_SETS);
}

export function createPreferenceExecuteTool() {
  return createExecuteTool(PREFERENCE_TOOL_SETS);
}
