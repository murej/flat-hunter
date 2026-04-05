import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { getPropertyExpertModel } from "@/lib/config/agent-models";
import { PropertyEvalSchema } from "@/lib/schemas";
import { PROPERTY_EXPERT_SYSTEM } from "./prompts";
import type { PropertyEvalResult } from "@/types";
import { clampScore } from "@/lib/utils/agent-output";
import { AGENT_NAME, TELEMETRY_TAG } from "./config";
import { ensureDbToolAgentsRegistered } from "@/lib/agents/registry-bootstrap";
import { getAgentConfig } from "@/lib/core/registry";

export async function runPropertyExpert(
  prompt: string,
  imageUrls: string[] = [],
): Promise<PropertyEvalResult> {
  await ensureDbToolAgentsRegistered();
  const cfg = getAgentConfig(AGENT_NAME);
  if (!cfg?.tools) {
    throw new Error("Property expert agent not registered");
  }

  const imageParts = imageUrls.slice(0, 3).map((url) => ({
    type: "image" as const,
    image: new URL(url),
  }));

  const messages =
    imageParts.length > 0
      ? [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: prompt }, ...imageParts],
          },
        ]
      : undefined;

  const result = await runAgent({
    systemPrompt: PROPERTY_EXPERT_SYSTEM,
    prompt: messages ? undefined : prompt,
    messages,
    tools: cfg.tools,
    providerTools: cfg.providerTools,
    model: getPropertyExpertModel(),
    maxSteps: cfg.maxSteps,
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
