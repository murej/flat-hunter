import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import { envBool } from "@/lib/utils/env-utils";
import { reportError } from "./reporting";
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

  // #region agent log
  if (input.telemetryTag === "email_verification") {
    const rawEv = process.env.EMAIL_VERIFICATION_MODEL;
    const rawDefault = process.env.LLM_DEFAULT_MODEL;
    const payload = {
      hypothesisId: "ev-model-H1-H5",
      runId: process.env.VERCEL ? "vercel" : "local",
      inputModelDefined: input.model !== undefined,
      inputModelLen: input.model?.length ?? -1,
      resolvedModelLen: model.length,
      resolvedTrimLen: model.trim().length,
      envEmailVerificationSet: rawEv !== undefined,
      envEmailVerificationLen: rawEv?.length ?? -1,
      envEmailVerificationTrimEmpty:
        rawEv != null && rawEv.trim().length === 0,
      envLlmDefaultLen: rawDefault?.length ?? -1,
      envLlmDefaultTrimEmpty:
        rawDefault != null && rawDefault.trim().length === 0,
    };
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "b75a44",
      },
      body: JSON.stringify({
        sessionId: "b75a44",
        location: "lib/core/agent.ts:runAgent",
        message: "email_verification model resolution",
        data: payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    console.log(
      JSON.stringify({
        debugSession: "b75a44",
        tag: "agent-email-verification-model",
        ...payload,
      }),
    );
  }
  // #endregion

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
