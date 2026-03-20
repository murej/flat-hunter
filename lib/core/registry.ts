import type { AgentConfig } from "./types";

const registry = new Map<string, AgentConfig>();

export function registerAgent(name: string, config: AgentConfig): void {
  registry.set(name, config);
}

export function getAgentConfig(name: string): AgentConfig | undefined {
  return registry.get(name);
}
