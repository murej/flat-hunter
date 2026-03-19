import type { Anthropic } from "@anthropic-ai/sdk";

/**
 * Anthropic native web search tool descriptor.
 * Use basic web_search_20250305 for broader model support and ZDR eligibility.
 */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
} as unknown as Anthropic.Tool;
