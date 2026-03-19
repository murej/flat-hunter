import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";
import { runAgent } from "@/lib/core/agent";
import { AREA_PROFILE_EVALUATOR_SYSTEM } from "@/lib/prompts/area-context";
import { getPostcodeContextForArea } from "@/lib/tools/area-context";
import type { AreaProfile } from "@/lib/tools/area-context";
import { retryWithBackoff } from "@/lib/utils/retry";

export const AREA_EXPERT_TOOL_SETS: ToolSet[] = ["db", "web_search"];

export function buildAreaExpertTools() {
  return buildTools(AREA_EXPERT_TOOL_SETS);
}

export function createAreaExpertExecuteTool() {
  return createExecuteTool(AREA_EXPERT_TOOL_SETS);
}

async function runAreaProfile(areaName: string): Promise<AreaProfile | null> {
  const { postcode, postcodeContext } =
    await getPostcodeContextForArea(areaName);

  const prompt = `Area: ${areaName}\n\nPostcode context: ${JSON.stringify(postcodeContext ?? { note: "No postcode data available" }, null, 2)}`;

  const result = await retryWithBackoff(() =>
    runAgent({
      systemPrompt: AREA_PROFILE_EVALUATOR_SYSTEM,
      prompt,
      model: "claude-sonnet-4-6",
    }),
  );

  const text = "message" in result ? result.message : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      area_name: areaName,
      postcode_used: postcode ?? null,
      crime_notes: parsed.crime_notes ?? "",
      amenities_notes: parsed.amenities_notes ?? "",
      character_notes: parsed.character_notes ?? "",
      flood_risk_notes: parsed.flood_risk_notes ?? "",
      transport_notes: parsed.transport_notes ?? "",
    };
  } catch {
    return null;
  }
}

export async function evaluatePreferredAreas(
  areaNames: string[],
): Promise<Record<string, AreaProfile>> {
  const results = await Promise.all(
    areaNames.map(async (name) => {
      const profile = await runAreaProfile(name);
      return { name, profile };
    }),
  );

  const profiles: Record<string, AreaProfile> = {};
  for (const { name, profile } of results) {
    if (profile) profiles[name] = profile;
  }
  return profiles;
}
