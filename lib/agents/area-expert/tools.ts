import { buildTools, buildProviderTools } from "@/lib/core/tools";
import { areaExpertDbConfig } from "@/lib/config/area-expert-db-config";
import {
  getAreaExpertToolSets,
  EXPERT_MAX_STEPS,
} from "@/lib/config/expert-web-search";

export async function getAreaExpertTools() {
  const sets = getAreaExpertToolSets();
  return {
    tools: await buildTools(sets, { db: areaExpertDbConfig }),
    providerTools: buildProviderTools(sets),
    maxSteps: EXPERT_MAX_STEPS,
  };
}
