import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { envBool } from "@/lib/utils/env-utils";
import type { RunAgentInput, RunAgentOutput } from "./types";

function getDefaultModel(): string {
  return process.env.LLM_DEFAULT_MODEL || "claude-haiku-4-5";
}

function logLlmUsage(
  tag: string | undefined,
  model: string | undefined,
  usage: { promptTokens: number; completionTokens: number },
) {
  if (!envBool("LLM_USAGE_LOG")) return;
  console.log(
    `[LLM] ${tag ?? "unknown"} model=${model ?? getDefaultModel()} in=${usage.promptTokens} out=${usage.completionTokens}`,
  );
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const model = input.model ?? getDefaultModel();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    model: anthropic(model),
    system: input.systemPrompt,
    messages: input.messages,
    prompt: input.prompt,
    tools: input.tools,
    maxSteps: input.maxSteps ?? 5,
    maxTokens: 4096,
    maxRetries: 4,
    onStepFinish({ usage }: { usage: { promptTokens: number; completionTokens: number } }) {
      logLlmUsage(input.telemetryTag, model, usage);
    },
  };

  if (input.output) {
    opts.experimental_output = input.output;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (generateText as any)(opts);

  if (input.output && result.experimental_output) {
    return { message: JSON.stringify(result.experimental_output) };
  }
  return { message: result.text };
}
