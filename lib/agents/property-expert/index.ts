import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { registerAgent } from "@/lib/core/registry";
import { getPropertyExpertModel } from "@/lib/config/agent-models";
import { PropertyEvalSchema } from "@/lib/schemas";
import { PROPERTY_EXPERT_SYSTEM } from "./prompts";
import { getPropertyExpertTools } from "./tools";
import type { PropertyEvalResult } from "@/types";
import { clampScore } from "@/lib/utils/agent-output";
import { AGENT_NAME, TELEMETRY_TAG } from "./config";

const { tools, providerTools, maxSteps } = getPropertyExpertTools();

registerAgent(AGENT_NAME, {
  systemPrompt: PROPERTY_EXPERT_SYSTEM,
  tools,
  providerTools,
  model: getPropertyExpertModel(),
  maxSteps,
});

export async function runPropertyExpert(
  prompt: string,
): Promise<PropertyEvalResult> {
  const result = await runAgent({
    systemPrompt: PROPERTY_EXPERT_SYSTEM,
    prompt,
    tools,
    providerTools,
    model: getPropertyExpertModel(),
    maxSteps,
    telemetryTag: TELEMETRY_TAG,
    output: Output.object({ schema: PropertyEvalSchema }),
  });

  const parsed = (await parseAgentJsonMessage(result.message, {
    source: "property-expert",
    telemetryTag: TELEMETRY_TAG,
  })) as Record<string, unknown>;
  return {
    price_score: clampScore(parsed.price_score as number),
    size_score: clampScore(parsed.size_score as number),
    appeal_score: clampScore(parsed.appeal_score as number),
    deal_breaker_flags: (parsed.deal_breaker_flags as string[] | undefined) || [],
    property_summary: parsed.property_summary as string,
    raw: parsed,
  };
}
