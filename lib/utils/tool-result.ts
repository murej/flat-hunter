const DEFAULT_MAX_CHARS = 4000;

export function truncateForToolResult(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}
