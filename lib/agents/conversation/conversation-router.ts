import { Output } from "ai";
import { z } from "zod";
import { runAgent } from "@/lib/core/agent";
import { getConversationRouterModel } from "@/lib/config/agent-models";
import { envBool } from "@/lib/utils/env-utils";

export type ConversationMode = "general" | "browse" | "preferences" | "insight";

const RouterOutputSchema = z.object({
  mode: z
    .enum(["general", "browse", "preferences", "insight"])
    .describe("Single best mode for this user message"),
});

const ROUTER_SYSTEM = `You pick exactly one mode for the next assistant turn of a UK property Telegram bot.

- general: thanks, vague chat, or nothing that clearly needs listings/prefs/scores. When unsure, use this.
- browse: search/show/open/save listings, scorecards, re-evaluate, "newest/cheapest/largest" type listing questions, anything about concrete properties without asking for a prose "why" for scores.
- preferences: show or change search preferences, saved/shortlist list, budget/areas/bedrooms criteria, "update preferences".
- insight: user wants why scores are what they are, a rating breakdown, or an in-depth comparison of multiple properties.

If both browse and insight seem possible, prefer browse unless they clearly ask why/how scores or to compare. Output only the structured field.`;

export type RouteSource = "fast" | "llm";

export async function resolveConversationMode(
  text: string,
): Promise<{ mode: ConversationMode; source: RouteSource }> {
  const trimmed = text.trim();
  if (!trimmed) {
    if (envBool("CONVERSATION_ROUTER_LOG")) {
      console.log("[conversation] router mode=general source=fast (empty)");
    }
    return { mode: "general", source: "fast" };
  }

  const result = await runAgent({
    systemPrompt: ROUTER_SYSTEM,
    prompt: trimmed,
    model: getConversationRouterModel(),
    maxSteps: 1,
    telemetryTag: "conversation_router",
    output: Output.object({ schema: RouterOutputSchema }),
  });

  let mode: ConversationMode = "general";
  try {
    const parsed = JSON.parse(result.message) as { mode?: string };
    const m = parsed.mode;
    if (
      m === "browse" ||
      m === "preferences" ||
      m === "insight" ||
      m === "general"
    ) {
      mode = m;
    }
  } catch {
    mode = "general";
  }

  return { mode, source: "llm" };
}
