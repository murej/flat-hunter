import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { getPropertyExpertModel } from "@/lib/config/agent-models";
import { PropertyEvalSchema } from "@/lib/schemas";
import { PROPERTY_EXPERT_SYSTEM } from "./prompts";
import type { PropertyEvalResult } from "@/types";
import { clampScore } from "@/lib/utils/agent-output";
import { AGENT_NAME, TELEMETRY_TAG } from "./config";
import { ensureDbToolAgentsRegistered } from "@/lib/agents/registry-bootstrap";
import { getAgentConfig } from "@/lib/core/registry";

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;
export const PORTAL_CDN_HOSTS = new Set([
  "media.rightmove.co.uk",
  "lc.zoocdn.com",
  "listing-images.zoocdn.com",
  "images.onthemarket.com",
  "images.primelocation.com",
]);

export function filterImageUrls(urls: string[]): URL[] {
  return urls.flatMap((raw) => {
    try {
      const u = new URL(raw);
      if (!["http:", "https:"].includes(u.protocol)) return [];
      if (IMAGE_EXTENSIONS.test(u.pathname) || PORTAL_CDN_HOSTS.has(u.hostname)) {
        return [u];
      }
      return [];
    } catch {
      return [];
    }
  });
}

export async function runPropertyExpert(
  prompt: string,
  imageUrls: string[] = [],
): Promise<PropertyEvalResult> {
  await ensureDbToolAgentsRegistered();
  const cfg = getAgentConfig(AGENT_NAME);
  if (!cfg?.tools) {
    throw new Error("Property expert agent not registered");
  }

  const validImageUrls = filterImageUrls(imageUrls);
  if (imageUrls.length > 0 && validImageUrls.length === 0) {
    console.warn(
      `[property-expert] 0 valid images from ${imageUrls.length} URLs — falling back to text-only`,
    );
  }
  const imageParts = validImageUrls.slice(0, 3).map((u) => ({
    type: "image" as const,
    image: u,
  }));

  const messages =
    imageParts.length > 0
      ? [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: prompt }, ...imageParts],
          },
        ]
      : undefined;

  const result = await runAgent({
    systemPrompt: PROPERTY_EXPERT_SYSTEM,
    prompt: messages ? undefined : prompt,
    messages,
    tools: cfg.tools,
    providerTools: cfg.providerTools,
    model: getPropertyExpertModel(),
    maxSteps: cfg.maxSteps,
    telemetryTag: TELEMETRY_TAG,
    output: Output.object({ schema: PropertyEvalSchema }),
  });

  const parsed = (await parseAgentJsonMessage(result.message, {
    source: "property-expert",
    telemetryTag: TELEMETRY_TAG,
  })) as Record<string, unknown>;

  const clampOrNull = (v: unknown): number | null =>
    v == null ? null : clampScore(v as number);

  return {
    price_score: clampOrNull(parsed.price_score),
    size_score: clampOrNull(parsed.size_score),
    appeal_score: clampOrNull(parsed.appeal_score),
    deal_breaker_flags: (parsed.deal_breaker_flags as string[] | undefined) || [],
    property_summary: parsed.property_summary as string,
    property_unknown: (parsed.property_unknown as string | undefined) ?? undefined,
    raw: parsed,
  };
}
