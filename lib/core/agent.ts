import Anthropic from "@anthropic-ai/sdk";
import { sendMessage } from "@/lib/telegram";

export async function sendError(
  message: string = "Something went wrong. Please try again.",
): Promise<void> {
  await sendMessage(message);
}

export type AgentMetadata = {
  listingId?: string | null;
  intent?: string | null;
};

export type DirectToolResult = {
  type: "direct";
  message: string;
  buttons?: Array<{ text: string; callback_data: string }>[];
  metadata?: AgentMetadata;
};

export type DataToolResult = {
  type: "data";
  data: string;
  toolName: string;
};

export type ToolResult = DirectToolResult | DataToolResult;

export type RunAgentInput = {
  systemPrompt: string;
  prompt: string;
  tools?: Anthropic.Tool[];
  model?: string;
  messages?: Anthropic.MessageParam[];
  executeTool?: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  maxToolIterations?: number;
};

export type MessageOutput = {
  message: string;
  buttons?: Array<{ text: string; callback_data: string }>[];
  metadata?: AgentMetadata;
};

export type DataOutput = {
  type: "data";
  data: string;
  toolName: string;
};

export type RunAgentOutput = MessageOutput | DataOutput;

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOOL_ITERATIONS = 5;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const {
    systemPrompt,
    prompt,
    tools,
    model = DEFAULT_MODEL,
    messages: history,
    executeTool,
    maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  } = input;

  const messages: Anthropic.MessageParam[] = history
    ? [...history, { role: "user" as const, content: prompt }]
    : [{ role: "user" as const, content: prompt }];

  let currentMessages = [...messages];
  let iterations = 0;

  while (iterations < maxToolIterations) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      ...(tools && tools.length > 0 ? { tools } : {}),
      messages: currentMessages,
    });

    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );

    if (toolBlocks.length === 0 || !executeTool) {
      const message = textBlock?.text ?? "";
      return { message };
    }

    const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

    for (const toolBlock of toolBlocks) {
      const toolInput = toolBlock.input as Record<string, unknown>;
      const result = await executeTool(toolBlock.name, toolInput);

      const content =
        result.type === "data" ? result.data : result.message;

      toolResultContents.push({
        type: "tool_result" as const,
        tool_use_id: toolBlock.id,
        content,
      });

      if (result.type === "data") {
        return {
          type: "data",
          data: result.data,
          toolName: result.toolName,
        };
      }
    }

    currentMessages = [
      ...currentMessages,
      { role: "assistant" as const, content: response.content },
      {
        role: "user" as const,
        content: toolResultContents,
      },
    ];
    iterations++;
  }

  return {
    message: "Max tool iterations reached. Please try again.",
  };
}
