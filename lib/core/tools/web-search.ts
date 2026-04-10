import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";

/** Anthropic native web search (provider tool). */
export function buildWebSearchProviderTool() {
  return anthropic.tools.webSearch_20250305({ maxUses: 3 });
}

/** Ollama cloud web search as a regular AI SDK tool. */
export function buildOllamaWebSearchTool() {
  return tool({
    description:
      "Search the web for current information. Use when you need up-to-date data about locations, prices, or local area details.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    execute: async ({ query }: { query: string }) => {
      const apiKey = process.env.OLLAMA_API_KEY;
      if (!apiKey) return { error: "OLLAMA_API_KEY not set" };
      const res = await fetch("https://ollama.com/api/web_search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, max_results: 5 }),
      });
      if (!res.ok) return { error: `Web search failed: ${res.status}` };
      return await res.json();
    },
  });
}
