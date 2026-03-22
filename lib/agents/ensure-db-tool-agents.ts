import { registerAgent } from "@/lib/core/registry";
import { getPropertyExpertModel, getAreaExpertModel } from "@/lib/config/agent-models";
import { getPropertyExpertTools } from "@/lib/agents/property-expert/tools";
import { getAreaExpertTools } from "@/lib/agents/area-expert/tools";
import { PROPERTY_EXPERT_SYSTEM } from "@/lib/agents/property-expert/prompts";
import { AREA_EXPERT_SYSTEM } from "@/lib/agents/area-expert/prompts";
import {
  AGENT_NAME as PROPERTY_AGENT_NAME,
} from "@/lib/agents/property-expert/config";
import { AGENT_NAME as AREA_AGENT_NAME } from "@/lib/agents/area-expert/config";

let initPromise: Promise<void> | null = null;

/**
 * Registers property-expert and area-expert with async-built tools (db_read schema RPC).
 * Idempotent; safe to call from every entrypoint that may use these agents or call_agent.
 */
export function ensureDbToolAgentsRegistered(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const p = await getPropertyExpertTools();
      registerAgent(PROPERTY_AGENT_NAME, {
        systemPrompt: PROPERTY_EXPERT_SYSTEM,
        tools: p.tools,
        providerTools: p.providerTools,
        model: getPropertyExpertModel(),
        maxSteps: p.maxSteps,
      });
      const a = await getAreaExpertTools();
      registerAgent(AREA_AGENT_NAME, {
        systemPrompt: AREA_EXPERT_SYSTEM,
        tools: a.tools,
        providerTools: a.providerTools,
        model: getAreaExpertModel(),
        maxSteps: a.maxSteps,
      });
    })();
  }
  return initPromise;
}
