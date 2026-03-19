import type { Anthropic } from "@anthropic-ai/sdk";
import { runAgent } from "../agent";
import { getAgentConfig } from "@/lib/core/registry";

export const CALL_AGENT_TOOL: Anthropic.Tool = {
  name: "call_agent",
  description:
    "Invoke another agent with a prompt. Use for delegation (e.g. preference, evaluator, property_expert).",
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
    return `Unknown agent: ${agent}. Available: preference, property_expert, area_expert`;
  }

  const result = await runAgent({
    systemPrompt: config.systemPrompt,
    prompt,
    tools: config.tools,
    model: config.model,
    executeTool: config.executeTool,
  });

  if ("type" in result && result.type === "data") {
    return result.data;
  }

  return "message" in result ? result.message : "";
}
