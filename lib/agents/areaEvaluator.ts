import Anthropic from "@anthropic-ai/sdk";
import { AREA_EVALUATOR_SYSTEM } from "@/lib/prompts";
import type { AreaEvalResult } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function areaEvaluator(
  addressOrPostcode: string
): Promise<AreaEvalResult> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: AREA_EVALUATOR_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Evaluate the area for this property location: ${addressOrPostcode}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) throw new Error("No JSON in area evaluator response");

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    area_score: parsed.area_score ?? 5,
    area_summary: parsed.area_summary ?? "",
    notable_flags: parsed.notable_flags ?? [],
    raw: parsed,
  };
}
