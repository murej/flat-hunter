import { runAgent } from "@/lib/core/agent";
import { AREA_EXPERT_SYSTEM } from "./area-expert.prompts";
import { buildTools, createExecuteTool, type ToolSet } from "@/lib/core/tools";

const TOOL_SETS: ToolSet[] = ["db", "web_search"];
const executeTool = createExecuteTool(TOOL_SETS);

function clampScore(score: unknown, fallback: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return fallback;
  if (score < 1) return 1;
  if (score > 10) return 10;
  return score;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches || matches.length === 0) {
    throw new Error("No JSON in area expert response");
  }
  return JSON.parse(matches[matches.length - 1]) as Record<string, unknown>;
}

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
    tools: buildTools(TOOL_SETS),
    model: "claude-sonnet-4-6",
    executeTool,
  });

  const text = "message" in result ? result.message : "";
  const parsed = extractJsonObject(text);

  return {
    area_score: clampScore(parsed.area_score, 5),
    area_summary:
      typeof parsed.area_summary === "string" ? parsed.area_summary : "",
    notable_flags: Array.isArray(parsed.notable_flags)
      ? parsed.notable_flags
      : [],
  };
}
