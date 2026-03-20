// Web search provider tool placeholder.
// The Anthropic AI SDK's built-in web search tool requires a model that supports it.
// This is a no-op in SDK versions without native web search support.
// When available, it would be: anthropic.tools.webSearch({ maxUses: 3 })

export function buildWebSearchTool(): unknown | null {
  try {
    // Dynamic check for web search support
    const { anthropic } = require("@ai-sdk/anthropic");
    if (anthropic.tools && "webSearch" in anthropic.tools) {
      return (anthropic.tools as Record<string, Function>).webSearch({ maxUses: 3 });
    }
  } catch {
    // Not available
  }
  return null;
}
