import Anthropic from "@anthropic-ai/sdk";

export type AgentMetadata = {
  listingId?: string | null;
  intent?: string | null;
};

export type AgentButton = {
  text: string;
  callback_data: string;
};

export type DirectToolResult = {
  type: "direct";
  message: string;
  buttons?: AgentButton[][];
  metadata?: AgentMetadata;
};

export type DataToolResult = {
  type: "data";
  data: string;
  toolName: string;
};

export type ToolResult = DirectToolResult | DataToolResult;

export type GenericAgentInput = {
  prompt: string;
  systemPrompt: string;
  tools?: Anthropic.Tool[];
  messages?: Anthropic.MessageParam[];
  executeTool?: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
};

export type MessageOutput = {
  message: string;
  buttons?: AgentButton[][];
  metadata?: AgentMetadata;
};

export type DataOutput = {
  type: "data";
  data: string;
  toolName: string;
};

export type GenericAgentOutput = MessageOutput | DataOutput;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runGenericAgent(
  input: GenericAgentInput,
): Promise<GenericAgentOutput> {
  const { prompt, systemPrompt, tools, messages: history, executeTool } = input;

  const messages: Anthropic.MessageParam[] = history
    ? [...history, { role: "user" as const, content: prompt }]
    : [{ role: "user" as const, content: prompt }];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    ...(tools && tools.length > 0 ? { tools } : {}),
    messages,
  });

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );

  // No tool called — return text response
  if (!toolBlock || !executeTool) {
    const message = textBlock?.text ?? "";
    return { message };
  }

  // Tool called — execute it
  const toolInput = toolBlock.input as Record<string, unknown>;
  const result = await executeTool(toolBlock.name, toolInput);

  if (result.type === "data") {
    return {
      type: "data",
      data: result.data,
      toolName: result.toolName,
    };
  }

  return {
    message: result.message,
    buttons: result.buttons,
    metadata: result.metadata,
  };
}
