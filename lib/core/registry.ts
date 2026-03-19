import type { Anthropic } from "@anthropic-ai/sdk";
import type { ToolResult } from "@/lib/core/agent";

export type AgentConfig = {
  systemPrompt: string;
  tools: Anthropic.Tool[];
  model: string;
  executeTool?: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
};

const registry: Map<string, AgentConfig> = new Map();

export function registerAgent(name: string, config: AgentConfig): void {
  registry.set(name, config);
}

export function getAgentConfig(name: string): AgentConfig | undefined {
  return registry.get(name);
}

export function getRegisteredAgents(): string[] {
  return Array.from(registry.keys());
}
