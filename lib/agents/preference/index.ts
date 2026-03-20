import { runAgent } from "@/lib/core/agent";
import { registerAgent } from "@/lib/core/registry";
import { getPreferenceCollectorModel, getAreaProfileModel } from "@/lib/config/agent-models";
import { envBool } from "@/lib/utils/env-utils";
import { PREFERENCE_COLLECTOR_SYSTEM } from "./prompts";
import { getPreferenceTools } from "./tools";
import { getPreferences } from "@/lib/supabase";
import { getPostcodeContextForArea } from "@/lib/tools/area";
import { runAreaExpert } from "@/lib/agents/area-expert";
import { AREA_PROFILE_PROMPT } from "@/lib/prompts/area";
import type { RunAgentOutput } from "@/lib/core/types";
import { AGENT_NAME, TELEMETRY_TAG, PREFERENCE_MAX_STEPS } from "./config";

const tools = getPreferenceTools();

registerAgent(AGENT_NAME, {
  systemPrompt: PREFERENCE_COLLECTOR_SYSTEM,
  tools,
  model: getPreferenceCollectorModel(),
  maxSteps: PREFERENCE_MAX_STEPS,
});

export async function runPreferenceAgent(
  prompt: string,
  messages?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<RunAgentOutput> {
  const result = await runAgent({
    systemPrompt: PREFERENCE_COLLECTOR_SYSTEM,
    prompt: messages ? undefined : prompt,
    messages: messages
      ? [...messages, { role: "user" as const, content: prompt }]
      : undefined,
    tools,
    model: getPreferenceCollectorModel(),
    maxSteps: PREFERENCE_MAX_STEPS,
    telemetryTag: TELEMETRY_TAG,
  });

  // After saving preferences, optionally batch-profile target areas
  if (envBool("AREA_PROFILE_BATCH")) {
    const prefs = await getPreferences();
    if (prefs?.areas) {
      for (const area of prefs.areas) {
        try {
          const ctx = await getPostcodeContextForArea(area);
          if (ctx) {
            await runAreaExpert(
              AREA_PROFILE_PROMPT(area),
              ctx as unknown as Record<string, unknown>,
            );
          }
        } catch (err) {
          console.error(`Area profile batch error for ${area}:`, err);
        }
      }
    }
  }

  return result;
}
