/** Cap tool_result strings so parent tool loops do not explode context. */
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 10_000;

export const PRIOR_FINDINGS_MAX_CHARS = 2000;

export function truncateForToolResult(
  text: string,
  maxChars: number = DEFAULT_TOOL_RESULT_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;
  const suffix = "… [truncated]";
  const take = Math.max(0, maxChars - suffix.length);
  return `${text.slice(0, take)}${suffix}`;
}

export function truncatePriorFindings(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (t.length <= PRIOR_FINDINGS_MAX_CHARS) return t;
  return `${t.slice(0, PRIOR_FINDINGS_MAX_CHARS - 1)}…`;
}
