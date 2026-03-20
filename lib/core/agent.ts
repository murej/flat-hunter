import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import { envBool } from "@/lib/utils/env-utils";
import type { RunAgentInput, RunAgentOutput } from "./types";

function getDefaultModel(): string {
  return process.env.LLM_DEFAULT_MODEL || "claude-haiku-4-5";
}

function logLlmUsage(
  tag: string | undefined,
  model: string | undefined,
  usage: { inputTokens?: number; outputTokens?: number },
) {
  if (!envBool("LLM_USAGE_LOG")) return;
  console.log(
    `[LLM] ${tag ?? "unknown"} model=${model ?? getDefaultModel()} in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0}`,
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
    stopWhen: stepCountIs(input.maxSteps ?? 5),
    maxTokens: 4096,
    maxRetries: 4,
    onStepFinish({ usage }: { usage: { inputTokens?: number; outputTokens?: number } }) {
      logLlmUsage(input.telemetryTag, model, usage);
    },
  };

  if (input.providerTools?.length) {
    opts.providerOptions = { anthropic: { tools: input.providerTools } };
  }

  if (input.output) {
    opts.output = input.output;
  }

  // Retry loop for structured output failures (model returns empty content)
  const maxAttempts = input.output ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (generateText as any)(opts);

      if (input.output && result.output) {
        return { message: JSON.stringify(result.output) };
      }
      return { message: result.text };
    } catch (err: unknown) {
      const isOutputError =
        err instanceof Error && err.name === "AI_NoObjectGeneratedError";
      if (isOutputError && attempt < maxAttempts) {
        console.warn(
          `[LLM] ${input.telemetryTag ?? "unknown"} structured output failed, retrying (${attempt}/${maxAttempts})`,
        );
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Unexpected: retry loop exited without result");
}
