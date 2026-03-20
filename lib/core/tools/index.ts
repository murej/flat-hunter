import type { CoreTool } from "ai";
import { buildDbReadTool, buildDbWriteTool, type DbToolConfig } from "./db";
import { buildCallAgentTool } from "./call-agent";
import { buildWebSearchTool } from "./web-search";

export type ToolSet = "db" | "call_agent" | "web_search";

type BuildToolsConfig = {
  db?: DbToolConfig;
};

export function buildTools(
  sets: ToolSet[],
  config?: BuildToolsConfig,
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  if (sets.includes("db") && config?.db) {
    tools.db_read = buildDbReadTool(config.db);
    tools.db_write = buildDbWriteTool(config.db);
  }

  if (sets.includes("call_agent")) {
    tools.call_agent = buildCallAgentTool();
  }

  return tools;
}

export function buildProviderTools(sets: ToolSet[]): unknown[] {
  const tools: unknown[] = [];

  if (sets.includes("web_search")) {
    const ws = buildWebSearchTool();
    if (ws) tools.push(ws);
  }

  return tools;
}

export type { DbToolConfig } from "./db";
