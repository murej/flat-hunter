const MAX_CHARS = 8000;

export function truncateForToolResult(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS) + "\n...[truncated]";
}
