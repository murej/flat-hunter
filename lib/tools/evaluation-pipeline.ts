import { reportError } from "@/lib/core/reporting";
import { getSupabaseAdmin, getListing, getPreferences } from "@/lib/supabase";
import { fetchAreaContext } from "./area";
import { evaluateCommute } from "./commute";
import { evaluateFinance } from "./finance";
import { buildScorecardText, buildScorecardButtons } from "./scorecard";
import { generateHighlights } from "./highlights";
import { getLatestMortgageRate } from "./mortgage-rate";
import { runPropertyExpert } from "@/lib/agents/property-expert";
import { runAreaExpert } from "@/lib/agents/area-expert";
import type {
  Listing,
  Preferences,
  PropertyEvalResult,
  AreaEvalResult,
  CommuteEvalResult,
  FinanceEvalResult,
  Evaluation,
} from "@/types";

function computeOverallScore(
  property: PropertyEvalResult,
  area: AreaEvalResult,
  commute: CommuteEvalResult,
  _finance: FinanceEvalResult,
  preferences: Preferences,
): { score: number; partial: boolean } {
  const w = preferences.score_weights ?? {};
  const weights = {
    appeal: w.appeal ?? 1,
    price: w.price ?? 1,
    size: w.size ?? 1,
    area: w.area ?? 1,
    commute: w.commute ?? 1,
  };

  const entries: Array<{ score: number | null; weight: number }> = [
    { score: property.appeal_score, weight: weights.appeal },
    { score: property.price_score, weight: weights.price },
    { score: property.size_score, weight: weights.size },
    { score: area.area_score, weight: weights.area },
    { score: commute.commute_score, weight: weights.commute },
  ];

  let totalWeight = 0;
  let weighted = 0;
  let partial = false;

  for (const { score, weight } of entries) {
    if (score == null) {
      partial = true;
      continue;
    }
    weighted += score * weight;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 10) / 10 : 0;
  return { score, partial };
}

export async function runEvaluationPipeline(listingId: string): Promise<{
  evaluation: Evaluation;
  listingId: string;
  scorecardText: string;
  scorecardButtons: Array<Array<{ text: string; callback_data: string }>>;
} | null> {
  const [listing, preferences] = await Promise.all([
    getListing(listingId),
    getPreferences(),
  ]);

  if (!listing || !preferences) return null;

  // Fetch area context
  const areaContext = await fetchAreaContext(
    listing.postcode,
    preferences.areas,
    listing.address,
  );

  // Check for prior agent_context
  const { data: priorContext } = await getSupabaseAdmin()
    .from("agent_context")
    .select("content")
    .eq("agent_id", "area_expert")
    .eq("scope", "area")
    .eq("scope_value", listing.postcode)
    .single();

  // Build prompts
  const propertyPrompt = buildPropertyPrompt(listing, preferences);
  const areaPrompt = buildAreaPrompt(listing, preferences, areaContext);

  // Property and area experts are Sonnet (TPM); never run concurrently.
  // Commute + finance overlap with property only (non-Anthropic).
  const [commuteResult, financeResult, propertyResult] = await Promise.all([
    evaluateCommute(
      listing.postcode,
      preferences.commute_postcode,
      preferences.commute_max_minutes,
      listing.address,
    ),
    evaluateFinance(listing.price, preferences.deposit),
    runPropertyExpert(propertyPrompt),
  ]);

  const areaResult = await runAreaExpert(
    areaPrompt,
    priorContext?.content as Record<string, unknown> | undefined,
  );

  // Store area context for future use
  if (areaContext) {
    await getSupabaseAdmin().from("agent_context").upsert(
      {
        agent_id: "area_expert",
        scope: "area",
        scope_value: listing.postcode,
        content: areaResult.raw,
        expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
      { onConflict: "agent_id,scope,scope_value" },
    );
  }

  const { score: overallScore, partial: partialScore } = computeOverallScore(
    propertyResult,
    areaResult,
    commuteResult,
    financeResult,
    preferences,
  );

  const preferenceSummary = [
    preferences.must_haves.length ? `Must-haves: ${preferences.must_haves.join(", ")}` : "",
    preferences.deal_breakers.length ? `Deal-breakers: ${preferences.deal_breakers.join(", ")}` : "",
    `Budget: £${preferences.max_price.toLocaleString("en-GB")}`,
    `Commute: max ${preferences.commute_max_minutes} min`,
    preferences.style_notes ? `Style: ${preferences.style_notes}` : "",
  ].filter(Boolean).join(". ");

  const highlights = await generateHighlights(
    propertyResult,
    areaResult,
    commuteResult,
    preferenceSummary,
  );

  // Insert evaluation
  const evaluationRow = {
    listing_id: listingId,
    price_score: propertyResult.price_score,
    size_score: propertyResult.size_score,
    appeal_score: propertyResult.appeal_score,
    commute_score: commuteResult.commute_score,
    area_score: areaResult.area_score,
    overall_score: overallScore,
    deal_breaker_flags: propertyResult.deal_breaker_flags,
    commute_minutes: commuteResult.commute_minutes,
    commute_route: commuteResult.commute_route,
    mortgage_monthly: financeResult.mortgage_monthly,
    interest_only_monthly: financeResult.interest_only_monthly,
    stamp_duty: financeResult.stamp_duty,
    stress_test_monthly: financeResult.stress_test_monthly,
    total_monthly: financeResult.total_monthly,
    property_summary: highlights,
    area_summary: areaResult.area_summary,
    raw_property_eval: propertyResult.raw,
    raw_area_eval: areaResult.raw,
    property_unknown: propertyResult.property_unknown ?? null,
    area_unknown: areaResult.area_unknown ?? null,
  };

  const { data: evaluation, error: upsertError } = await getSupabaseAdmin()
    .from("evaluations")
    .upsert(evaluationRow, { onConflict: "listing_id" })
    .select()
    .single();

  if (upsertError || !evaluation) {
    await reportError(
      upsertError ?? new Error("Evaluation upsert returned no row"),
      {
        source: "evaluation/upsert",
        telemetryTag: `listing:${listingId}`,
      },
    );
    return null;
  }

  const { data: completedRows, error: statusError } = await getSupabaseAdmin()
    .from("listings")
    .update({ status: "evaluated", updated_at: new Date().toISOString() })
    .eq("id", listingId)
    .eq("status", "evaluating")
    .select("id");

  if (statusError) {
    await reportError(statusError, {
      source: "evaluation/listing-status",
      telemetryTag: `listing:${listingId}`,
    });
    return null;
  }

  if (!completedRows?.length) {
    await reportError(
      new Error("Listing was not in evaluating state when marking evaluated"),
      {
        source: "evaluation/listing-status",
        telemetryTag: `listing:${listingId}`,
      },
    );
    return null;
  }

  const eval_ = evaluation as Evaluation;
  const [updatedListing, mortgageRate] = await Promise.all([
    getListing(listingId),
    getLatestMortgageRate(),
  ]);

  return {
    evaluation: eval_,
    listingId,
    scorecardText: buildScorecardText(updatedListing!, eval_, mortgageRate, partialScore),
    scorecardButtons: buildScorecardButtons(listingId),
  };
}

function buildPropertyPrompt(listing: Listing, preferences: Preferences): string {
  const desc =
    listing.description.length > 3500
      ? listing.description.slice(0, 3500) + "..."
      : listing.description;

  return `Evaluate this property against the buyer's preferences.

**Property:**
- Title: ${listing.title}
- Price: £${listing.price.toLocaleString("en-GB")}
- Address: ${listing.address} (${listing.postcode})
- Bedrooms: ${listing.bedrooms} | Bathrooms: ${listing.bathrooms}${listing.sqft ? ` | Sqft: ${listing.sqft}` : ""}
- Description: ${desc}

**Buyer preferences:**
- Max price: £${preferences.max_price.toLocaleString("en-GB")}
- Min bedrooms: ${preferences.min_bedrooms}
- Must-haves: ${preferences.must_haves.join(", ") || "None specified"}
- Deal-breakers: ${preferences.deal_breakers.join(", ") || "None specified"}
- Style: ${preferences.style_notes || "No style preference"}
- Notes: ${preferences.freeform_notes || "None"}

Read the buyer's full preferences from the database if you need more context.`;
}

function buildAreaPrompt(
  listing: Listing,
  preferences: Preferences,
  areaContext: Awaited<ReturnType<typeof fetchAreaContext>>,
): string {
  return `Evaluate the area around ${listing.address} (${listing.postcode}) for a buyer interested in: ${preferences.areas.join(", ")}.

${preferences.area_preferences?.length ? `Area preferences: ${preferences.area_preferences.join(", ")}` : ""}

${areaContext ? `Pre-fetched area data is provided separately.` : "No pre-fetched area data available. Use database tools to check for existing area profiles."}

Read the buyer's preferences from the database for full context.`;
}
