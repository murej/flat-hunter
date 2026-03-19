import type { Anthropic } from "@anthropic-ai/sdk";
import { runAgent } from "../agent";
import {
  getAgentConfig,
  getRegisteredAgents,
} from "@/lib/core/registry";
import { truncateForToolResult } from "@/lib/utils/tool-result";

export const CALL_AGENT_TOOL: Anthropic.Tool = {
  name: "call_agent",
  description:
    "Delegate to registered agent: preference, property_expert, area_expert.",
  input_schema: {
    type: "object" as const,
    properties: {
      agent: {
        type: "string",
        description: "Agent name: preference, property_expert, area_expert",
      },
      prompt: {
        type: "string",
        description: "The prompt to send to the agent",
      },
    },
    required: ["agent", "prompt"],
  },
};

export async function executeCallAgent(
  agent: string,
  prompt: string,
): Promise<string> {
  const config = getAgentConfig(agent);
  if (!config) {
    return `Unknown agent: ${agent}. Available: ${getRegisteredAgents().join(", ")}`;
  }

  const result = await runAgent({
    systemPrompt: config.systemPrompt,
    prompt,
    tools: config.tools,
    model: config.model,
    executeTool: config.executeTool,
    maxToolIterations: config.maxToolIterations,
    telemetryTag: `call_agent:${agent}`,
  });

  if ("type" in result && result.type === "data") {
    return truncateForToolResult(result.data);
  }

  const msg = "message" in result ? result.message : "";
  return truncateForToolResult(msg);
}
