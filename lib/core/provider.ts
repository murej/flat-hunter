import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { envLlmProvider, type LlmProvider } from "@/lib/utils/env-utils";

const GEMMA_DEFAULT_MODEL = "gemma-4-e4b";

let cached: LlmProvider | null = null;

function getProvider(): LlmProvider {
  if (!cached) cached = envLlmProvider();
  return cached;
}

export function isGemma(): boolean {
  return getProvider() === "gemma";
}

export function resolveModel(anthropicModelId: string) {
  if (getProvider() === "gemma") {
    const baseURL = process.env.GEMMA_BASE_URL;
    if (!baseURL)
      throw new Error("GEMMA_BASE_URL is required when LLM_PROVIDER=gemma");
    const model = process.env.GEMMA_MODEL?.trim() || GEMMA_DEFAULT_MODEL;
    const gemma = createOpenAICompatible({ name: "gemma", baseURL });
    return gemma.chatModel(model);
  }
  return anthropic(anthropicModelId);
}
