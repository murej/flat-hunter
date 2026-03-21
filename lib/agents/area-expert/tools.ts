import { buildTools, buildProviderTools } from "@/lib/core/tools";
import { dbConfig } from "@/lib/config/db-config";
import {
  getAreaExpertToolSets,
  EXPERT_MAX_STEPS,
} from "@/lib/config/expert-web-search";

export function getAreaExpertTools() {
  const sets = getAreaExpertToolSets();
  return {
    tools: buildTools(sets, { db: dbConfig }),
    providerTools: buildProviderTools(sets),
    maxSteps: EXPERT_MAX_STEPS,
  };
}
