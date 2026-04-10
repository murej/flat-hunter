import { generateText, stepCountIs } from "ai";
import { resolveModel, isGemma } from "./provider";
import { envBool } from "@/lib/utils/env-utils";
import { reportError } from "./reporting";
import type { RunAgentInput, RunAgentOutput } from "./types";

const FALLBACK_MODEL_ID = "claude-haiku-4-5";

function getDefaultModel(): string {
  const raw = process.env.LLM_DEFAULT_MODEL;
  if (raw == null || raw === "") return FALLBACK_MODEL_ID;
  const t = raw.trim();
  return t === "" ? FALLBACK_MODEL_ID : t;
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
  const rawResolved = input.model ?? getDefaultModel();
  const trimmed = rawResolved.trim();
  const model = trimmed === "" ? FALLBACK_MODEL_ID : trimmed;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    model: resolveModel(model),
    system: input.systemPrompt,
    messages: input.messages,
    prompt: input.prompt,
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 5),
    maxTokens: 4096,
    maxRetries: 4,
    onStepFinish({
      usage,
    }: {
      usage: { inputTokens?: number; outputTokens?: number };
    }) {
      logLlmUsage(input.telemetryTag, model, usage);
    },
  };

  if (input.providerTools?.length && !isGemma()) {
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

      for (const step of result.steps as Array<{
        stepNumber: number;
        finishReason: string;
        rawFinishReason?: string;
        content: Array<{ type: string; toolName?: string; error?: unknown }>;
      }>) {
        for (const part of step.content) {
          if (part.type === "tool-error") {
            await reportError(part.error, {
              source: "tool",
              toolName: part.toolName,
              telemetryTag: input.telemetryTag,
            });
          }
        }
        if (step.finishReason === "error") {
          await reportError(
            new Error("LLM step finished with finishReason error"),
            {
              source: "agent",
              telemetryTag: input.telemetryTag,
              stepNumber: step.stepNumber,
              rawFinishReason: step.rawFinishReason,
            },
          );
        }
      }

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
      await reportError(err, {
        source: "agent",
        telemetryTag: input.telemetryTag,
      });
      throw err;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Unexpected: retry loop exited without result");
}
