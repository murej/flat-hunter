import { runAgent } from "@/lib/core/agent";
import { PROPERTY_EXPERT_SYSTEM } from "./prompts";
import {
  buildPropertyExpertTools,
  createPropertyExpertExecuteTool,
} from "./tools";
import { registerAgent } from "@/lib/core/registry";
import { clampScore, extractJsonObject } from "@/lib/utils/agent-output";

const executeTool = createPropertyExpertExecuteTool();

registerAgent("property_expert", {
  systemPrompt: PROPERTY_EXPERT_SYSTEM,
  tools: buildPropertyExpertTools(),
  model: "claude-sonnet-4-6",
  executeTool,
});

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
    tools: buildPropertyExpertTools(),
    model: "claude-sonnet-4-6",
    executeTool,
  });

  const text = "message" in result ? result.message : "";
  const parsed = extractJsonObject(text, "property expert response");

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
