import { runAgent } from "@/lib/core/agent";
import { PROPERTY_EXPERT_SYSTEM } from "./prompts";
import {
  buildPropertyExpertTools,
  createPropertyExpertExecuteTool,
} from "./tools";
import { registerAgent } from "@/lib/core/registry";
import { clampScore, extractJsonObject } from "@/lib/utils/agent-output";
import { truncatePriorFindings } from "@/lib/utils/tool-result";

const executeTool = createPropertyExpertExecuteTool();

const WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS = 3;

const MAX_DESCRIPTION_CHARS = 2500;
const MAX_IMAGE_URLS = 4;

function slimListingForPropertyExpert(
  listing: Record<string, unknown>,
): Record<string, unknown> {
  const description = String(listing.description ?? "");
  const urls = Array.isArray(listing.image_urls)
    ? (listing.image_urls as unknown[]).filter((u) => typeof u === "string")
    : [];
  const image_urls = urls.slice(0, MAX_IMAGE_URLS);

  return {
    id: listing.id,
    title: listing.title,
    address: listing.address,
    postcode: listing.postcode,
    price: listing.price,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    sqft: listing.sqft,
    description:
      description.length > MAX_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…`
        : description,
    url: listing.url,
    floorplan_url: listing.floorplan_url,
    agent_name: listing.agent_name,
    agent_email: listing.agent_email,
    listed_date: listing.listed_date,
    status: listing.status,
    image_urls,
  };
}

function slimPreferencesForPropertyExpert(
  preferences: Record<string, unknown>,
): Record<string, unknown> {
  const raw = preferences.raw_json as Record<string, unknown> | undefined;
  const score_weights =
    raw && typeof raw.score_weights === "object" && raw.score_weights !== null
      ? raw.score_weights
      : undefined;

  return {
    areas: preferences.areas,
    max_price: preferences.max_price,
    deposit: preferences.deposit,
    min_bedrooms: preferences.min_bedrooms,
    must_haves: preferences.must_haves,
    deal_breakers: preferences.deal_breakers,
    commute_anchor: preferences.commute_anchor,
    commute_anchor_postcode: preferences.commute_anchor_postcode,
    max_commute_minutes: preferences.max_commute_minutes,
    style_notes: preferences.style_notes,
    freeform_notes: preferences.freeform_notes,
    area_preferences: preferences.area_preferences,
    ...(score_weights ? { score_weights } : {}),
  };
}

registerAgent("property_expert", {
  systemPrompt: PROPERTY_EXPERT_SYSTEM,
  tools: buildPropertyExpertTools(),
  model: "claude-sonnet-4-6",
  executeTool,
  maxToolIterations: WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS,
});

export type PropertyExpertResult = {
  price_score: number;
  size_score: number;
  fit_score: number;
  deal_breaker_flags: string[];
  property_summary: string;
};

export async function runPropertyExpert(
  listing: Record<string, unknown>,
  preferences: Record<string, unknown>,
  priorFindings?: string,
): Promise<PropertyExpertResult> {
  const slimListing = slimListingForPropertyExpert(listing);
  const slimPrefs = slimPreferencesForPropertyExpert(preferences);
  const prior = truncatePriorFindings(priorFindings);
  const prompt = `Property:\n${JSON.stringify(slimListing)}\n\nPreferences:\n${JSON.stringify(slimPrefs)}${prior ? `\n\nPrior findings:\n${prior}` : ""}`;

  const result = await runAgent({
    systemPrompt: PROPERTY_EXPERT_SYSTEM,
    prompt,
    tools: buildPropertyExpertTools(),
    model: "claude-sonnet-4-6",
    executeTool,
    maxToolIterations: WEB_SEARCH_EXPERT_MAX_TOOL_ITERATIONS,
  });

  const text = "message" in result ? result.message : "";
  const parsed = extractJsonObject(text, "property expert response");

  return {
    price_score: clampScore(parsed.price_score, 5),
    size_score: clampScore(parsed.size_score, 5),
    fit_score: clampScore(parsed.fit_score, 5),
    deal_breaker_flags: Array.isArray(parsed.deal_breaker_flags)
      ? parsed.deal_breaker_flags
      : [],
    property_summary:
      typeof parsed.property_summary === "string"
        ? parsed.property_summary
        : "",
  };
}
