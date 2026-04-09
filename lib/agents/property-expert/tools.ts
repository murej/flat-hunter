import { buildTools, buildProviderTools } from "@/lib/core/tools";
import {
  getPropertyExpertToolSets,
  PROPERTY_EXPERT_MAX_STEPS,
} from "@/lib/config/expert-web-search";

export async function getPropertyExpertTools() {
  const sets = getPropertyExpertToolSets();
  return {
    tools: await buildTools(sets),
    providerTools: buildProviderTools(sets),
    maxSteps: PROPERTY_EXPERT_MAX_STEPS,
  };
}
