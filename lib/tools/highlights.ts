import { z } from "zod";
import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { reportError } from "@/lib/core/reporting";
import { getHighlightsModel } from "@/lib/config/agent-models";
import type { PropertyEvalResult, AreaEvalResult, CommuteEvalResult } from "@/types";

const HighlightsSchema = z.object({
  highlights: z
    .array(z.string())
    .describe(
      "3-7 highlight lines. Each starts with ✅ (pro), ➖ (neutral), or ❌ (con) followed by a short phrase.",
    ),
});

const HIGHLIGHTS_SYSTEM = `You produce a concise list of 3-7 match highlights for a property scorecard.

Each line must start with exactly one emoji:
- ✅ for a pro (positive match against buyer preferences)
- ➖ for a neutral (mixed or unremarkable)
- ❌ for a con (negative, mismatch, or deal-breaker)

Rules:
- Cover the most important factors across fit, price, size, area, commute, and any deal-breakers.
- Each highlight is one short phrase (under 60 chars). No full sentences.
- Most important highlights first.
- Do NOT repeat scores or numbers — the scorecard already shows those.`;

export async function generateHighlights(
  property: PropertyEvalResult,
  area: AreaEvalResult,
  commute: CommuteEvalResult,
  preferenceSummary: string,
): Promise<string> {
  const fmt = (s: number | null) => s != null ? `${s}/10` : "N/A";
  const prompt = `**Scores:** Fit ${fmt(property.fit_score)}, Price ${fmt(property.price_score)}, Size ${fmt(property.size_score)}, Area ${fmt(area.area_score)}, Commute ${fmt(commute.commute_score)}
**Property verdict:** ${property.property_summary}
**Area verdict:** ${area.area_summary}
**Deal-breakers:** ${property.deal_breaker_flags.length > 0 ? property.deal_breaker_flags.join(", ") : "None"}
**Commute:** ${commute.commute_minutes != null ? `${commute.commute_minutes} min — ${commute.commute_route}` : "Unknown"}
**Buyer wants:** ${preferenceSummary}`;

  const result = await runAgent({
    systemPrompt: HIGHLIGHTS_SYSTEM,
    prompt,
    model: getHighlightsModel(),
    maxSteps: 1,
    telemetryTag: "highlights",
    output: Output.object({ schema: HighlightsSchema }),
  });

  const parsed = (await parseAgentJsonMessage(result.message, {
    source: "highlights",
    telemetryTag: "highlights",
  })) as { highlights?: unknown };
  if (!Array.isArray(parsed.highlights)) {
    const err = new Error("Highlights output missing highlights array");
    await reportError(err, { source: "highlights/parse", telemetryTag: "highlights" });
    throw err;
  }
  const order = { "✅": 0, "➖": 1, "❌": 2 };
  const sorted = [...parsed.highlights].sort((a: string, b: string) => {
    const aOrder = order[a.charAt(0) as keyof typeof order] ?? 1;
    const bOrder = order[b.charAt(0) as keyof typeof order] ?? 1;
    return aOrder - bOrder;
  });
  return sorted.join("\n");
}
