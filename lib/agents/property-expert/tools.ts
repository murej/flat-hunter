import { buildTools, buildProviderTools } from "@/lib/core/tools";
import { dbConfig } from "@/lib/config/db-config";
import {
  getPropertyExpertToolSets,
  EXPERT_MAX_STEPS,
} from "@/lib/config/expert-web-search";

export function getPropertyExpertTools() {
  const sets = getPropertyExpertToolSets();
  return {
    tools: buildTools(sets, { db: dbConfig }),
    providerTools: buildProviderTools(sets),
    maxSteps: EXPERT_MAX_STEPS,
  };
}
