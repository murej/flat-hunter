import { runAgent } from "@/lib/core/agent";
import { AREA_EXPERT_SYSTEM } from "./prompts";
import { slimAreaContextForExpert } from "./context";
import { truncatePriorFindings } from "@/lib/utils/tool-result";
import {
  buildAreaExpertTools,
  createAreaExpertExecuteTool,
  evaluatePreferredAreas,
} from "./tools";
import { registerAgent } from "@/lib/core/registry";
import { clampScore, extractJsonObject } from "@/lib/utils/agent-output";

const executeTool = createAreaExpertExecuteTool();

const WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS = 3;

registerAgent("area_expert", {
  systemPrompt: AREA_EXPERT_SYSTEM,
  tools: buildAreaExpertTools(),
  model: "claude-sonnet-4-6",
  executeTool,
  maxToolIterations: WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS,
});

export type { AreaProfile } from "@/lib/tools/area";
export { evaluatePreferredAreas } from "./tools";

export type AreaExpertResult = {
  area_score: number;
  area_summary: string;
  notable_flags: string[];
};

export async function runAreaExpert(
  areaContext: Record<string, unknown>,
  priorFindings?: string,
): Promise<AreaExpertResult> {
  const slim = slimAreaContextForExpert(areaContext);
  const prior = truncatePriorFindings(priorFindings);
  const prompt = `Area context:\n${JSON.stringify(slim)}${prior ? `\n\nPrior findings:\n${prior}` : ""}`;

  const result = await runAgent({
    systemPrompt: AREA_EXPERT_SYSTEM,
    prompt,
    tools: buildAreaExpertTools(),
    model: "claude-sonnet-4-6",
    executeTool,
    maxToolIterations: WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS,
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
