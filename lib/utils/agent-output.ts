export function clampScore(score: unknown, fallback: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return fallback;
  if (score < 1) return 1;
  if (score > 10) return 10;
  return score;
}

/**
 * Best-effort parse of a single JSON object from model output (optional ```json fence,
 * or first `{` … `}` block). Returns null if nothing parses.
 */
export function tryExtractJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  if (s.startsWith("{")) {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      /* try substring matches below */
    }
  }

  const matches = s.match(/\{[\s\S]*\}/g);
  if (matches && matches.length > 0) {
    for (let i = matches.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(matches[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function extractJsonObject(
  text: string,
  context = "agent response",
): Record<string, unknown> {
  const parsed = tryExtractJsonObject(text);
  if (!parsed) {
    throw new Error(`No JSON in ${context}`);
  }
  return parsed;
}

/** Short tag for logs when expert output is not JSON (see terminal diagnostics). */
export function expertOutputParseHint(text: string): string {
  const t = text.trim();
  if (!t) return "empty_final_text";
  if (t.includes("Max tool iterations reached")) return "max_tool_iterations";
  if (!/\{/.test(t)) return "no_json_object";
  return "invalid_or_unbalanced_json";
}
