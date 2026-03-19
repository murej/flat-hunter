import { runAgent } from "@/lib/core/agent";
import { AREA_EXPERT_SYSTEM } from "./prompts";
import {
  buildAreaExpertTools,
  createAreaExpertExecuteTool,
} from "./tools";
import { registerAgent } from "@/lib/core/registry";
import { clampScore, extractJsonObject } from "@/lib/utils/agent-output";

const executeTool = createAreaExpertExecuteTool();

registerAgent("area_expert", {
  systemPrompt: AREA_EXPERT_SYSTEM,
  tools: buildAreaExpertTools(),
  model: "claude-sonnet-4-6",
  executeTool,
});

export type AreaExpertResult = {
  area_score: number;
  area_summary: string;
  notable_flags: string[];
};

export async function runAreaExpert(
  areaContext: Record<string, unknown>,
  priorFindings?: string,
): Promise<AreaExpertResult> {
  const prompt = `Area context:\n${JSON.stringify(areaContext, null, 2)}${priorFindings ? `\n\nPrior findings:\n${priorFindings}` : ""}`;

  const result = await runAgent({
    systemPrompt: AREA_EXPERT_SYSTEM,
    prompt,
    tools: buildAreaExpertTools(),
    model: "claude-sonnet-4-6",
    executeTool,
  });

  const text = "message" in result ? result.message : "";
  const parsed = extractJsonObject(text, "area expert response");

  return {
    area_score: clampScore(parsed.area_score, 5),
    area_summary:
      typeof parsed.area_summary === "string" ? parsed.area_summary : "",
    notable_flags: Array.isArray(parsed.notable_flags)
      ? parsed.notable_flags
      : [],
  };
}
