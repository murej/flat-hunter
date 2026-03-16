import OpenAI from "openai";
import { AREA_EVALUATOR_SYSTEM } from "@/lib/prompts";
import type { AreaEvalResult } from "@/types";

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export async function areaEvaluator(
  addressOrPostcode: string
): Promise<AreaEvalResult> {
  const response = await client.chat.completions.create({
    model: "gemini-2.0-flash",
    max_tokens: 4096,
    messages: [
      { role: "system", content: AREA_EVALUATOR_SYSTEM },
      {
        role: "user",
        content: `Evaluate the area for this property location: ${addressOrPostcode}`,
      },
    ],
  });

  const text = response.choices[0].message.content ?? "{}";
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
