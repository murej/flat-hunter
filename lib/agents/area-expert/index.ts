import { getAreaExpertModel } from "@/lib/config/agent-models";
import { getExpertMaxToolIterations } from "@/lib/config/expert-web-search";
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
import {
  clampScore,
  expertOutputParseHint,
  tryExtractJsonObject,
} from "@/lib/utils/agent-output";

const executeTool = createAreaExpertExecuteTool();

const EXPERT_MAX_TOOL_ITERATIONS = getExpertMaxToolIterations();
const AREA_EXPERT_MODEL = getAreaExpertModel();

registerAgent("area_expert", {
  systemPrompt: AREA_EXPERT_SYSTEM,
  tools: buildAreaExpertTools(),
  model: AREA_EXPERT_MODEL,
  executeTool,
  maxToolIterations: EXPERT_MAX_TOOL_ITERATIONS,
});

export type { AreaProfile } from "@/lib/tools/area";
export { evaluatePreferredAreas } from "./tools";

export type AreaExpertResult = {
  area_score: number;
  area_summary: string;
  notable_flags: string[];
  area_unknown?: true;
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
    model: AREA_EXPERT_MODEL,
    executeTool,
    maxToolIterations: EXPERT_MAX_TOOL_ITERATIONS,
    telemetryTag: "area_expert",
  });

  const text = "message" in result ? result.message : "";
  const parsed = tryExtractJsonObject(text);
  if (!parsed) {
    console.warn(
      `Area expert: no parseable JSON (${expertOutputParseHint(text)}); preview=${JSON.stringify(text.slice(0, 220))}`,
    );
    return {
      area_score: 0,
      area_summary: "Evaluation unavailable",
      notable_flags: [] as string[],
      area_unknown: true as const,
    };
  }

  return {
    area_score: clampScore(parsed.area_score, 5),
    area_summary:
      typeof parsed.area_summary === "string" ? parsed.area_summary : "",
    notable_flags: Array.isArray(parsed.notable_flags)
      ? parsed.notable_flags
      : [],
  };
}
