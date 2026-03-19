import { getPropertyExpertToolSets } from "@/lib/config/expert-web-search";
import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";

const PROPERTY_EXPERT_TOOL_SETS: ToolSet[] = getPropertyExpertToolSets();

export function buildPropertyExpertTools() {
  return buildTools(PROPERTY_EXPERT_TOOL_SETS);
}

export function createPropertyExpertExecuteTool() {
  return createExecuteTool(PROPERTY_EXPERT_TOOL_SETS);
}
