export function clampScore(score: unknown, fallback: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return fallback;
  if (score < 1) return 1;
  if (score > 10) return 10;
  return score;
}

export function extractJsonObject(
  text: string,
  context = "agent response",
): Record<string, unknown> {
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches || matches.length === 0) {
    throw new Error(`No JSON in ${context}`);
  }
  return JSON.parse(matches[matches.length - 1]) as Record<string, unknown>;
}
