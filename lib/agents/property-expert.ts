import { runAgent } from "@/lib/core/agent";
import { PROPERTY_EXPERT_SYSTEM } from "./property-expert.prompts";
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
    throw new Error("No JSON in property expert response");
  }
  return JSON.parse(matches[matches.length - 1]) as Record<string, unknown>;
}

export type PropertyExpertResult = {
  price_score: number;
  size_score: number;
  fit_score: number;
  deal_breaker_flags: string[];
  property_summary: string;
};

export async function runPropertyExpert(
  listing: Record<string, unknown>,
  preferences: Record<string, unknown>,
  priorFindings?: string,
): Promise<PropertyExpertResult> {
  const prompt = `Property:\n${JSON.stringify(listing, null, 2)}\n\nPreferences:\n${JSON.stringify(preferences, null, 2)}${priorFindings ? `\n\nPrior findings:\n${priorFindings}` : ""}`;

  const result = await runAgent({
    systemPrompt: PROPERTY_EXPERT_SYSTEM,
    prompt,
    tools: buildTools(TOOL_SETS),
    model: "claude-sonnet-4-6",
    executeTool,
  });

  const text = "message" in result ? result.message : "";
  const parsed = extractJsonObject(text);

  return {
    price_score: clampScore(parsed.price_score, 5),
    size_score: clampScore(parsed.size_score, 5),
    fit_score: clampScore(parsed.fit_score, 5),
    deal_breaker_flags: Array.isArray(parsed.deal_breaker_flags)
      ? parsed.deal_breaker_flags
      : [],
    property_summary:
      typeof parsed.property_summary === "string"
        ? parsed.property_summary
        : "",
  };
}
