import type { Anthropic } from "@anthropic-ai/sdk";
import type { ToolResult } from "../agent";
import { dbRead, dbWrite } from "./db";
import { executeCallAgent } from "./call-agent";
import { CALL_AGENT_TOOL } from "./call-agent";
import { DB_READ_TOOL, DB_WRITE_TOOL } from "./db";
import { WEB_SEARCH_TOOL } from "./web-search";

export { CALL_AGENT_TOOL, DB_READ_TOOL, DB_WRITE_TOOL, WEB_SEARCH_TOOL };
export { executeCallAgent } from "./call-agent";
export { dbRead, dbWrite } from "./db";

export type ToolSet = "db" | "call_agent" | "web_search";

export function createExecuteTool(tools: ToolSet[]): (
  name: string,
  input: Record<string, unknown>,
) => Promise<ToolResult> {
  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    if (name === "db_read" && tools.includes("db")) {
      const result = await dbRead(
        input.table as string,
        input.filters as Record<string, unknown> | undefined,
        (input.limit as number) ?? 100,
      );
      const data = result.ok
        ? JSON.stringify(result.data)
        : result.error;
      return { type: "data", data, toolName: "db_read" };
    }

    if (name === "db_write" && tools.includes("db")) {
      const result = await dbWrite(
        input.table as string,
        input.operation as "insert" | "upsert" | "update",
        input.data as Record<string, unknown>,
        input.filters as Record<string, unknown> | undefined,
      );
      const data = result.ok
        ? JSON.stringify(result.data ?? "ok")
        : result.error;
      return { type: "data", data, toolName: "db_write" };
    }

    if (name === "call_agent" && tools.includes("call_agent")) {
      const data = await executeCallAgent(
        input.agent as string,
        input.prompt as string,
      );
      return { type: "data", data, toolName: "call_agent" };
    }

    return {
      type: "data",
      data: `Unknown or unavailable tool: ${name}`,
      toolName: name,
    };
  };
}

export function buildTools(toolSets: ToolSet[]): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];

  if (toolSets.includes("db")) {
    tools.push(DB_READ_TOOL as Anthropic.Tool);
    tools.push(DB_WRITE_TOOL as Anthropic.Tool);
  }

  if (toolSets.includes("call_agent")) {
    tools.push(CALL_AGENT_TOOL);
  }

  if (toolSets.includes("web_search")) {
    tools.push(WEB_SEARCH_TOOL);
  }

  return tools;
}
