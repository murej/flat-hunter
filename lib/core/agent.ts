import Anthropic from "@anthropic-ai/sdk";
import { getRunAgentDefaultModel } from "@/lib/config/agent-models";
import { envBool } from "@/lib/config/env-utils";
import { sendMessage } from "@/lib/telegram";
import {
  isAnthropicRateOrOverloadError,
  sleep,
  sleepMsFromAnthropicRetryAfter,
} from "@/lib/utils/retry";

export type AgentMetadata = {
  listingId?: string | null;
  intent?: string | null;
};

export type DirectToolResult = {
  type: "direct";
  message: string;
  buttons?: Array<{ text: string; callback_data: string }>[];
  metadata?: AgentMetadata;
  /** Telegram parse mode for formatted tool replies (e.g. HTML scorecards). */
  parse_mode?: string | false;
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
  /** When LLM_USAGE_LOG=true, included in structured usage logs. */
  telemetryTag?: string;
};

export type MessageOutput = {
  message: string;
  buttons?: Array<{ text: string; callback_data: string }>[];
  metadata?: AgentMetadata;
  parse_mode?: string | false;
};

export type DataOutput = {
  type: "data";
  data: string;
  toolName: string;
};

export type RunAgentOutput = MessageOutput | DataOutput;

const DEFAULT_MAX_TOOL_ITERATIONS = 5;
const ANTHROPIC_MESSAGES_MAX_ATTEMPTS = 8;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function messagesCreateWithRateLimitRetries(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Messages.Message> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ANTHROPIC_MESSAGES_MAX_ATTEMPTS; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (e) {
      lastError = e;
      if (
        !isAnthropicRateOrOverloadError(e) ||
        attempt === ANTHROPIC_MESSAGES_MAX_ATTEMPTS - 1
      ) {
        throw e;
      }
      const ms = sleepMsFromAnthropicRetryAfter(e, attempt);
      await sleep(ms);
    }
  }
  throw lastError;
}

function logLlmUsage(
  telemetryTag: string | undefined,
  model: string,
  usage: unknown,
): void {
  if (!envBool(process.env.LLM_USAGE_LOG, false, "LLM_USAGE_LOG")) return;
  console.log(
    JSON.stringify({
      kind: "llm_usage",
      telemetryTag: telemetryTag ?? null,
      model,
      usage,
    }),
  );
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const {
    systemPrompt,
    prompt,
    tools,
    model = getRunAgentDefaultModel(),
    messages: history,
    executeTool,
    maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
    telemetryTag,
  } = input;

  const messages: Anthropic.MessageParam[] = history
    ? [...history, { role: "user" as const, content: prompt }]
    : [{ role: "user" as const, content: prompt }];

  let currentMessages = [...messages];
  let iterations = 0;

  while (iterations < maxToolIterations) {
    const response = await messagesCreateWithRateLimitRetries({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      ...(tools && tools.length > 0 ? { tools } : {}),
      messages: currentMessages,
    });

    logLlmUsage(telemetryTag, model, response.usage);

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

      const content = result.type === "data" ? result.data : result.message;

      toolResultContents.push({
        type: "tool_result" as const,
        tool_use_id: toolBlock.id,
        content,
      });

      if (result.type === "data") {
        // db_read/db_write are intermediate: let the model see results and produce final output
        if (
          result.toolName === "db_read" ||
          result.toolName === "db_write"
        ) {
          // continue loop
        } else {
          return {
            type: "data",
            data: result.data,
            toolName: result.toolName,
          };
        }
      }

      if (result.type === "direct") {
        return {
          message: result.message,
          ...(result.buttons && { buttons: result.buttons }),
          ...(result.metadata && { metadata: result.metadata }),
          ...(result.parse_mode != null && { parse_mode: result.parse_mode }),
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

  // Hitting the limit usually means the model used tools on every turn and never got
  // a slot for a text-only JSON reply (iterations counts completed tool rounds).
  // One more call *without* tools forces a text completion.
  if (tools && tools.length > 0 && executeTool) {
    const finalResponse = await messagesCreateWithRateLimitRetries({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        ...currentMessages,
        {
          role: "user" as const,
          content:
            "Stop using tools for this request. Output ONLY one JSON object exactly as specified in your system instructions (all required keys and types). No markdown code fence, no commentary before or after.",
        },
      ],
    });

    const finalToolBlocks = finalResponse.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const finalText = finalResponse.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );

    if (finalToolBlocks.length === 0 && finalText?.text?.trim()) {
      return { message: finalText.text };
    }
  }

  return {
    message: "Max tool iterations reached. Please try again.",
  };
}

export async function sendError(
  message: string = "Something went wrong. Please try again.",
): Promise<void> {
  await sendMessage(message);
}
