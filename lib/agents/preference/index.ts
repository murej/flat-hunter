import { getPreferenceMaxToolIterations } from "@/lib/config/conversation-llm";
import { supabaseAdmin, logConversation, getPreferences } from "@/lib/supabase";
import { PREFERENCE_COLLECTOR_SYSTEM } from "./prompts";
import { evaluatePreferredAreas } from "@/lib/agents/area-expert";
import { runAgent } from "@/lib/core/agent";
import { registerAgent } from "@/lib/core/registry";
import { buildPreferenceTools, createPreferenceExecuteTool } from "./tools";
import { truncateForToolResult } from "@/lib/utils/tool-result";

const preferenceExecuteTool = createPreferenceExecuteTool();

const PREFERENCE_MAX_TOOL_ITERATIONS = getPreferenceMaxToolIterations();

const PREFERENCE_HISTORY_MSG_MAX = 1000;
const PREFERENCE_HISTORY_KEEP_RECENT = 8;

registerAgent("preference", {
  systemPrompt: PREFERENCE_COLLECTOR_SYSTEM,
  tools: buildPreferenceTools(),
  model: "claude-haiku-4-5",
  executeTool: preferenceExecuteTool,
  maxToolIterations: PREFERENCE_MAX_TOOL_ITERATIONS,
});

export async function collectPreferences(
  userMessage: string,
  messageId: string,
): Promise<{ message: string }> {
  await logConversation({
    telegram_message_id: messageId,
    direction: "inbound",
    message: userMessage,
    intent: "preferences",
  });

  const { data: historyDesc } = await supabaseAdmin
    .from("conversations")
    .select("direction, message")
    .eq("intent", "preferences")
    .order("created_at", { ascending: false })
    .limit(16);

  const history = (historyDesc || []).reverse();
  const messages = history.map((row) => ({
    role: (row.direction === "inbound" ? "user" : "assistant") as
      | "user"
      | "assistant",
    content: truncateForToolResult(
      String(row.message ?? ""),
      PREFERENCE_HISTORY_MSG_MAX,
    ),
  }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: userMessage });
  }

  const lastUserContent =
    messages.filter((m) => m.role === "user").pop()?.content ?? userMessage;

  let priorMessages = messages.slice(0, -1);
  if (priorMessages.length > PREFERENCE_HISTORY_KEEP_RECENT) {
    const omitted = priorMessages.length - PREFERENCE_HISTORY_KEEP_RECENT;
    priorMessages = [
      {
        role: "user" as const,
        content: `[${omitted} older preference messages omitted.]`,
      },
      ...priorMessages.slice(-PREFERENCE_HISTORY_KEEP_RECENT),
    ];
  }

  const result = await runAgent({
    systemPrompt: PREFERENCE_COLLECTOR_SYSTEM,
    prompt: lastUserContent,
    tools: buildPreferenceTools(),
    model: "claude-haiku-4-5",
    messages: priorMessages,
    maxToolIterations: PREFERENCE_MAX_TOOL_ITERATIONS,
    telemetryTag: "preference_collector",
    executeTool: preferenceExecuteTool,
  });

  const assistantText = "message" in result ? result.message : "";

  await logConversation({
    direction: "outbound",
    message: assistantText,
    intent: "preferences",
  });

  const prefMatch = assistantText.match(
    /<preferences>([\s\S]*?)<\/preferences>/,
  );
  if (prefMatch) {
    try {
      const parsed = JSON.parse(prefMatch[1].trim());
      const existing = await getPreferences();

      const merged = {
        areas:
          parsed.areas !== undefined ? parsed.areas : (existing?.areas ?? []),
        max_price:
          parsed.max_price !== undefined
            ? parsed.max_price
            : (existing?.max_price ?? 0),
        deposit:
          parsed.deposit !== undefined
            ? parsed.deposit
            : (existing?.deposit ?? 0),
        min_bedrooms:
          parsed.min_bedrooms !== undefined
            ? parsed.min_bedrooms
            : (existing?.min_bedrooms ?? 1),
        must_haves:
          parsed.must_haves !== undefined
            ? parsed.must_haves
            : (existing?.must_haves ?? []),
        deal_breakers:
          parsed.deal_breakers !== undefined
            ? parsed.deal_breakers
            : (existing?.deal_breakers ?? []),
        commute_anchor:
          parsed.commute_anchor !== undefined
            ? parsed.commute_anchor
            : (existing?.commute_anchor ?? ""),
        commute_anchor_postcode:
          parsed.commute_anchor_postcode !== undefined
            ? parsed.commute_anchor_postcode
            : (existing?.commute_anchor_postcode ?? ""),
        max_commute_minutes:
          parsed.max_commute_minutes !== undefined
            ? parsed.max_commute_minutes
            : (existing?.max_commute_minutes ?? 60),
        style_notes:
          parsed.style_notes !== undefined
            ? parsed.style_notes
            : (existing?.style_notes ?? ""),
        freeform_notes:
          parsed.freeform_notes !== undefined
            ? parsed.freeform_notes
            : (existing?.freeform_notes ?? ""),
        area_preferences:
          parsed.area_preferences !== undefined
            ? parsed.area_preferences
            : (existing?.area_preferences ?? []),
      };

      const existingRaw = (existing?.raw_json as Record<string, unknown>) ?? {};
      const areasChanged =
        JSON.stringify(merged.areas ?? []) !==
        JSON.stringify(existing?.areas ?? []);
      const existingProfiles = existingRaw.area_profiles as
        | Record<string, unknown>
        | undefined;
      const needsAreaProfiles =
        merged.areas?.length > 0 &&
        (areasChanged ||
          !existingProfiles ||
          Object.keys(existingProfiles).length === 0);
      let area_profiles: Record<string, unknown> | undefined;
      if (needsAreaProfiles) {
        try {
          area_profiles = (await evaluatePreferredAreas(
            merged.areas,
          )) as Record<string, unknown>;
        } catch (e) {
          console.error("Failed to evaluate preferred areas:", e);
        }
      }

      const payload: Record<string, unknown> = {
        ...merged,
        raw_json: {
          ...merged,
          score_weights: parsed.score_weights ?? existingRaw.score_weights,
          area_profiles:
            merged.areas?.length === 0
              ? {}
              : area_profiles && Object.keys(area_profiles).length > 0
                ? area_profiles
                : ((existingRaw.area_profiles as
                    | Record<string, unknown>
                    | undefined) ?? {}),
        },
        updated_at: new Date().toISOString(),
      };
      if (existing?.id) {
        payload.id = existing.id;
      }

      await supabaseAdmin.from("preferences").upsert(payload);

      const confirmText =
        assistantText
          .replace(/<preferences>[\s\S]*?<\/preferences>/, "")
          .trim() + "\n\n✅ Your preferences have been saved!";

      return { message: confirmText };
    } catch (e) {
      console.error("Failed to parse preferences JSON:", e);
      return { message: assistantText };
    }
  }
  return { message: assistantText };
}
