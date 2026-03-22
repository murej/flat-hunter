import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { getAreaExpertModel } from "@/lib/config/agent-models";
import { AreaEvalSchema } from "@/lib/schemas";
import { AREA_EXPERT_SYSTEM } from "./prompts";
import { slimAreaContext } from "./context";
import type { AreaEvalResult } from "@/types";
import { clampScore } from "@/lib/utils/agent-output";
import { AGENT_NAME, TELEMETRY_TAG } from "./config";
import { ensureDbToolAgentsRegistered } from "@/lib/agents/ensure-db-tool-agents";
import { getAgentConfig } from "@/lib/core/registry";

export async function runAreaExpert(
  prompt: string,
  areaContext?: Record<string, unknown>,
): Promise<AreaEvalResult> {
  await ensureDbToolAgentsRegistered();
  const cfg = getAgentConfig(AGENT_NAME);
  if (!cfg?.tools) {
    throw new Error("Area expert agent not registered");
  }

  const contextStr = areaContext
    ? `\n\nPre-fetched area data:\n${JSON.stringify(slimAreaContext(areaContext as Parameters<typeof slimAreaContext>[0]), null, 2)}`
    : "";

  const result = await runAgent({
    systemPrompt: AREA_EXPERT_SYSTEM,
    prompt: prompt + contextStr,
    tools: cfg.tools,
    providerTools: cfg.providerTools,
    model: getAreaExpertModel(),
    maxSteps: cfg.maxSteps,
    telemetryTag: TELEMETRY_TAG,
    output: Output.object({ schema: AreaEvalSchema }),
  });

  const parsed = (await parseAgentJsonMessage(result.message, {
    source: "area-expert",
    telemetryTag: TELEMETRY_TAG,
  })) as Record<string, unknown>;
  return {
    area_score: clampScore(parsed.area_score as number),
    area_summary: parsed.area_summary as string,
    notable_flags: (parsed.notable_flags as string[] | undefined) || [],
    raw: parsed,
  };
}
