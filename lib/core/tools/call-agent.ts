import { tool } from "ai";
import { z } from "zod";
import { getAgentConfig } from "../registry";
import { runAgent } from "../agent";
import { truncateForToolResult } from "@/lib/utils/tool-result";

export function buildCallAgentTool() {
  return tool({
    description:
      "Delegate a task to a registered specialist agent. Use when you need expert help on a specific topic.",
    inputSchema: z.object({
      agent: z
        .string()
        .describe("The name of the registered agent to call"),
      prompt: z
        .string()
        .describe("The task or question to send to the agent"),
    }),
    execute: async ({ agent, prompt }) => {
      const { ensureDbToolAgentsRegistered } = await import(
        "@/lib/agents/ensure-db-tool-agents"
      );
      await ensureDbToolAgentsRegistered();

      const config = getAgentConfig(agent);
      if (!config) return `Error: agent "${agent}" not found in registry.`;

      const result = await runAgent({
        systemPrompt: config.systemPrompt,
        prompt,
        tools: config.tools,
        providerTools: config.providerTools,
        model: config.model,
        maxSteps: config.maxSteps,
        telemetryTag: `call_agent:${agent}`,
      });
      return truncateForToolResult(result.message);
    },
  });
}
