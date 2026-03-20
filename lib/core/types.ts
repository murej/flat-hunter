import type { CoreTool } from "ai";

export type RunAgentInput = {
  systemPrompt: string;
  prompt?: string;
  tools?: Record<string, CoreTool>;
  providerTools?: unknown[];
  model?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  maxSteps?: number;
  telemetryTag?: string;
  output?: unknown;
};

export type RunAgentOutput = {
  message: string;
};

export type DirectToolResult = {
  type: "direct";
  message: string;
  payload?: Record<string, unknown>;
};

export type DataToolResult = {
  type: "data";
  data: unknown;
  toolName: string;
};

export type ToolResult = DirectToolResult | DataToolResult;

export type AgentConfig = {
  systemPrompt: string;
  tools?: Record<string, CoreTool>;
  providerTools?: unknown[];
  model: string;
  maxSteps: number;
};
