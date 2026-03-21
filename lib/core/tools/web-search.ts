import { anthropic } from "@ai-sdk/anthropic";

export function buildWebSearchTool() {
  return anthropic.tools.webSearch_20250305({ maxUses: 3 });
}
