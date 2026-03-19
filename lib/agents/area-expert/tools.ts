import {
  getAreaProfileModel,
  isAreaProfileBatchEnabled,
} from "@/lib/config/conversation-llm";
import { getAreaExpertToolSets } from "@/lib/config/expert-web-search";
import { runAgent } from "@/lib/core/agent";
import pLimit from "p-limit";
import {
  buildTools,
  createExecuteTool,
  type ToolSet,
} from "@/lib/core/tools";
import {
  AREA_PROFILE_BATCH_SYSTEM,
  AREA_PROFILE_EVALUATOR_SYSTEM,
} from "@/lib/prompts/area";
import { getPostcodeContextForArea } from "@/lib/tools/area";
import type { AreaProfile } from "@/lib/tools/area";
import { retryWithBackoff } from "@/lib/utils/retry";

const AREA_EXPERT_TOOL_SETS: ToolSet[] = getAreaExpertToolSets();

export function buildAreaExpertTools() {
  return buildTools(AREA_EXPERT_TOOL_SETS);
}

export function createAreaExpertExecuteTool() {
  return createExecuteTool(AREA_EXPERT_TOOL_SETS);
}

function profileFromParsed(
  areaName: string,
  postcode: string | null,
  parsed: Record<string, unknown>,
): AreaProfile {
  return {
    area_name: areaName,
    postcode_used: postcode,
    crime_notes: String(parsed.crime_notes ?? ""),
    amenities_notes: String(parsed.amenities_notes ?? ""),
    character_notes: String(parsed.character_notes ?? ""),
    flood_risk_notes: String(parsed.flood_risk_notes ?? ""),
    transport_notes: String(parsed.transport_notes ?? ""),
  };
}

async function runAreaProfile(areaName: string): Promise<AreaProfile | null> {
  const { postcode, postcodeContext } =
    await getPostcodeContextForArea(areaName);

  const prompt = `Area: ${areaName}\n\nPostcode context: ${JSON.stringify(postcodeContext ?? { note: "No postcode data available" }, null, 2)}`;

  const result = await retryWithBackoff(() =>
    runAgent({
      systemPrompt: AREA_PROFILE_EVALUATOR_SYSTEM,
      prompt,
      model: getAreaProfileModel(),
      telemetryTag: "area_profile",
    }),
  );

  const text = "message" in result ? result.message : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return profileFromParsed(areaName, postcode ?? null, parsed);
  } catch {
    return null;
  }
}

const AREA_PROFILE_CONCURRENCY = 4;

async function evaluatePreferredAreasSequential(
  areaNames: string[],
): Promise<Record<string, AreaProfile>> {
  const limit = pLimit(AREA_PROFILE_CONCURRENCY);
  const results = await Promise.all(
    areaNames.map((name) =>
      limit(async () => {
        const profile = await runAreaProfile(name);
        return { name, profile };
      }),
    ),
  );

  const profiles: Record<string, AreaProfile> = {};
  for (const { name, profile } of results) {
    if (profile) profiles[name] = profile;
  }
  return profiles;
}

async function evaluatePreferredAreasBatch(
  areaNames: string[],
): Promise<Record<string, AreaProfile>> {
  const limit = pLimit(AREA_PROFILE_CONCURRENCY);
  const rows = await Promise.all(
    areaNames.map((name) =>
      limit(() => getPostcodeContextForArea(name)),
    ),
  );

  const payload = areaNames.map((name, i) => {
    const { postcode, postcodeContext } = rows[i];
    return {
      area_name: name,
      postcode,
      postcode_context:
        postcodeContext ?? ({ note: "No postcode data available" } as const),
    };
  });

  const result = await retryWithBackoff(() =>
    runAgent({
      systemPrompt: AREA_PROFILE_BATCH_SYSTEM,
      prompt: `Areas JSON:\n${JSON.stringify(payload, null, 2)}`,
      model: getAreaProfileModel(),
      telemetryTag: "area_profile_batch",
    }),
  );

  const text = "message" in result ? result.message : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in batch area profile response");

  const top = JSON.parse(jsonMatch[0]) as {
    profiles?: Record<string, Record<string, unknown>>;
  };
  const profilesRaw = top.profiles;
  if (!profilesRaw || typeof profilesRaw !== "object") {
    throw new Error("Missing profiles object");
  }

  const profiles: Record<string, AreaProfile> = {};
  for (let i = 0; i < areaNames.length; i++) {
    const name = areaNames[i];
    const block = profilesRaw[name];
    if (!block || typeof block !== "object") continue;
    profiles[name] = profileFromParsed(
      name,
      rows[i]?.postcode ?? null,
      block as Record<string, unknown>,
    );
  }

  if (Object.keys(profiles).length < areaNames.length) {
    throw new Error("Incomplete batch profiles");
  }

  return profiles;
}

export async function evaluatePreferredAreas(
  areaNames: string[],
): Promise<Record<string, AreaProfile>> {
  if (areaNames.length === 0) return {};

  const tryBatch =
    isAreaProfileBatchEnabled() && areaNames.length >= 2;

  if (tryBatch) {
    try {
      return await evaluatePreferredAreasBatch(areaNames);
    } catch (e) {
      console.error("Batched area profiles failed, falling back per-area:", e);
    }
  }

  return evaluatePreferredAreasSequential(areaNames);
}
