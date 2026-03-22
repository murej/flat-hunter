import type { Tool } from "ai";
import { buildDbReadTool, buildDbWriteTool, type DbToolConfig } from "./db";
import { buildCallAgentTool } from "./call-agent";
import { buildWebSearchTool } from "./web-search";
import { getDbReadSchemaDescriptionAppendix } from "./db-read-schema-appendix";

export type ToolSet = "db" | "call_agent" | "web_search";

type BuildToolsConfig = {
  db?: DbToolConfig;
};

export async function buildTools(
  sets: ToolSet[],
  config?: BuildToolsConfig,
): Promise<Record<string, Tool>> {
  const tools: Record<string, Tool> = {};

  if (sets.includes("db") && config?.db) {
    const schemaAppendix = await getDbReadSchemaDescriptionAppendix(
      config.db,
    );
    tools.db_read = buildDbReadTool(config.db, schemaAppendix);
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
    tools.push(buildWebSearchTool());
  }

  return tools;
}

export type { DbToolConfig } from "./db";
