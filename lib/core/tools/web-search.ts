// Web search provider tool.
// Requires @ai-sdk/anthropic with webSearch support (not yet available in ^1.2.0).
// When the SDK adds webSearch, update this to return the tool.

import { anthropic } from "@ai-sdk/anthropic";

export function buildWebSearchTool(): unknown | null {
  const tools = anthropic.tools as Record<string, unknown>;
  if ("webSearch" in tools && typeof tools.webSearch === "function") {
    return (tools.webSearch as (opts: { maxUses: number }) => unknown)({ maxUses: 3 });
  }
  return null;
}
