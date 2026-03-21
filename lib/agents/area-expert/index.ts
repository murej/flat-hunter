import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { registerAgent } from "@/lib/core/registry";
import { getAreaExpertModel } from "@/lib/config/agent-models";
import { AreaEvalSchema } from "@/lib/schemas";
import { AREA_EXPERT_SYSTEM } from "./prompts";
import { getAreaExpertTools } from "./tools";
import { slimAreaContext } from "./context";
import type { AreaEvalResult } from "@/types";
import { clampScore } from "@/lib/utils/agent-output";
import { AGENT_NAME, TELEMETRY_TAG } from "./config";

const { tools, providerTools, maxSteps } = getAreaExpertTools();

registerAgent(AGENT_NAME, {
  systemPrompt: AREA_EXPERT_SYSTEM,
  tools,
  providerTools,
  model: getAreaExpertModel(),
  maxSteps,
});

export async function runAreaExpert(
  prompt: string,
  areaContext?: Record<string, unknown>,
): Promise<AreaEvalResult> {
  const contextStr = areaContext
    ? `\n\nPre-fetched area data:\n${JSON.stringify(slimAreaContext(areaContext as Parameters<typeof slimAreaContext>[0]), null, 2)}`
    : "";

  const result = await runAgent({
    systemPrompt: AREA_EXPERT_SYSTEM,
    prompt: prompt + contextStr,
    tools,
    providerTools,
    model: getAreaExpertModel(),
    maxSteps,
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
