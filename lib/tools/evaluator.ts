import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, getListing, getPreferences } from "@/lib/supabase";
import { retryWithBackoff } from "@/lib/utils/retry";
import { COMBINED_EVALUATOR_SYSTEM } from "@/lib/prompts";
import { fetchAreaContext } from "./area-context";
import { evaluateCommute } from "./commute";
import { calculateFinance } from "./finance";
import { composeScorecard, composeNoScoreScorecard } from "./scorecard";
import type { CombinedEvalResult, Evaluation, Listing } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCORE_THRESHOLD = 6;

export async function combinedEvaluator(
  listingId: string,
  preferences: NonNullable<Awaited<ReturnType<typeof getPreferences>>>,
): Promise<CombinedEvalResult> {
  const listing = await getListing(listingId);

  const areaContext = await fetchAreaContext(
    listing.postcode ?? "",
    preferences.areas ?? [],
    listing.address,
  );

  const areaProfiles =
    (preferences.raw_json?.area_profiles as Record<string, unknown> | undefined) ??
    {};

  const areaContextBlock =
    areaContext.postcode ||
    areaContext.target_area_match !== null ||
    Object.keys(areaProfiles).length > 0 ||
    areaContext.crime ||
    areaContext.imd
      ? `\n\nArea context:\n${JSON.stringify(
          {
            postcode: areaContext.postcode,
            target_area_match: areaContext.target_area_match,
            target_areas: areaContext.target_areas,
            crime: areaContext.crime,
            imd: areaContext.imd,
            preferred_area_profiles: areaProfiles,
          },
          null,
          2,
        )}`
      : "";

  const response = await retryWithBackoff(() =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: COMBINED_EVALUATOR_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Property:\n${JSON.stringify(listing, null, 2)}\n\nPreferences:\n${JSON.stringify(preferences, null, 2)}${areaContextBlock}`,
        },
      ],
    }),
  );

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) throw new Error("No JSON in combined evaluator response");

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    price_score: parsed.price_score ?? 5,
    size_score: parsed.size_score ?? 5,
    fit_score: parsed.fit_score ?? 5,
    deal_breaker_flags: parsed.deal_breaker_flags ?? [],
    property_summary: parsed.property_summary ?? "",
    area_score: parsed.area_score ?? 5,
    area_summary: parsed.area_summary ?? "",
    notable_flags: parsed.notable_flags ?? [],
    raw: parsed,
  };
}

export type EvaluationPipelineResult = {
  sent: boolean;
  evaluation: Evaluation;
  listing: Listing;
  overall_score: number;
  notable_flags: string[];
  commute_minutes: number;
  unknownScores: { property?: boolean; area?: boolean; commute?: boolean };
  shouldSendNoScore: boolean;
};

export async function runEvaluationPipeline(
  listingId: string,
  options?: { sendImmediately?: boolean },
): Promise<boolean | EvaluationPipelineResult> {
  const sendImmediately = options?.sendImmediately !== false;
  const listing = await getListing(listingId);
  const preferences = await getPreferences();

  if (!preferences) {
    throw new Error("No preferences found — cannot evaluate listing");
  }

  const [combinedResult, commuteResult, financeResult] = await Promise.all([
    combinedEvaluator(listingId, preferences).catch((e) => {
      console.error("Combined evaluator failed:", e);
      return {
        price_score: 0,
        size_score: 0,
        fit_score: 0,
        property_unknown: true as const,
        deal_breaker_flags: [],
        property_summary: "",
        area_score: 0,
        area_summary: "Evaluation unavailable",
        area_unknown: true as const,
        notable_flags: [],
        raw: {},
      };
    }),
    evaluateCommute(
      listing.postcode,
      preferences?.commute_anchor_postcode ?? "",
      preferences?.max_commute_minutes ?? 60,
      listing.address,
    ).catch((e) => {
      console.error("Commute evaluator failed:", e);
      return {
        commute_minutes: 0,
        commute_route: "Commute data unavailable",
        commute_score: 0,
        commute_unknown: true as const,
      };
    }),
    calculateFinance(listing.price, preferences?.deposit ?? 0).catch((e) => {
      console.error("Finance agent failed:", e);
      return {
        monthly_mortgage: 0,
        monthly_interest_only: 0,
        stamp_duty: 0,
        estimated_monthly_total: 0,
        raw: {},
      };
    }),
  ]);

  const componentKeys = [
    ...(combinedResult.property_unknown
      ? []
      : (["price", "size", "fit"] as const)),
    ...(combinedResult.area_unknown ? [] : (["area"] as const)),
    ...(commuteResult.commute_unknown ? [] : (["commute"] as const)),
  ];
  const scoreComponents = [
    ...(combinedResult.property_unknown
      ? []
      : [
          combinedResult.price_score,
          combinedResult.size_score,
          combinedResult.fit_score,
        ]),
    ...(combinedResult.area_unknown ? [] : [combinedResult.area_score]),
    ...(commuteResult.commute_unknown ? [] : [commuteResult.commute_score]),
  ];

  const weightsConfig = preferences.raw_json?.score_weights as
    | Record<string, number>
    | undefined;
  const getWeight = (key: string) =>
    (weightsConfig && typeof weightsConfig[key] === "number"
      ? weightsConfig[key]
      : 1) as number;

  const overall_score =
    scoreComponents.length > 0
      ? (() => {
          const weightedSum = scoreComponents.reduce(
            (sum, score, i) => sum + score * getWeight(componentKeys[i]),
            0,
          );
          const totalWeight = componentKeys.reduce(
            (sum, key) => sum + getWeight(key),
            0,
          );
          return totalWeight > 0 ? weightedSum / totalWeight : 0;
        })()
      : 0;

  const raw = combinedResult.raw as Record<string, unknown> | undefined;

  const { data: evaluation, error } = await supabaseAdmin
    .from("evaluations")
    .insert({
      listing_id: listingId,
      price_score: combinedResult.price_score,
      size_score: combinedResult.size_score,
      fit_score: combinedResult.fit_score,
      area_score: combinedResult.area_score,
      commute_score: commuteResult.commute_score,
      overall_score: Math.round(overall_score * 10) / 10,
      deal_breaker_flags: combinedResult.deal_breaker_flags,
      commute_minutes: commuteResult.commute_minutes,
      commute_route: commuteResult.commute_route,
      monthly_mortgage: financeResult.monthly_mortgage,
      monthly_interest_only: financeResult.monthly_interest_only,
      stamp_duty: financeResult.stamp_duty,
      estimated_monthly_total: financeResult.estimated_monthly_total,
      property_summary: combinedResult.property_summary,
      area_summary: combinedResult.area_summary,
      raw_property_eval: {
        price_score: raw?.price_score,
        size_score: raw?.size_score,
        fit_score: raw?.fit_score,
        deal_breaker_flags:
          (raw?.deal_breaker_flags as string[] | undefined) ?? [],
        property_summary: raw?.property_summary,
      },
      raw_area_eval: {
        area_score: raw?.area_score,
        area_summary: raw?.area_summary,
        notable_flags: (raw?.notable_flags as string[] | undefined) ?? [],
      },
      raw_finance_eval: financeResult.raw,
    })
    .select()
    .single();

  if (error) throw error;

  const unknownScores = {
    property: combinedResult.property_unknown,
    area: combinedResult.area_unknown,
    commute: commuteResult.commute_unknown,
  };

  const result: EvaluationPipelineResult = {
    sent: scoreComponents.length === 0 || overall_score > SCORE_THRESHOLD,
    evaluation,
    listing,
    overall_score,
    notable_flags: combinedResult.notable_flags,
    commute_minutes: commuteResult.commute_minutes,
    unknownScores,
    shouldSendNoScore: scoreComponents.length === 0,
  };

  if (sendImmediately) {
    if (result.shouldSendNoScore) {
      await composeNoScoreScorecard(evaluation, listing);
      return true;
    }
    if (overall_score > SCORE_THRESHOLD) {
      await composeScorecard(
        evaluation,
        listing,
        combinedResult.notable_flags,
        commuteResult.commute_minutes,
        unknownScores,
      );
      return true;
    }
    await supabaseAdmin
      .from("listings")
      .update({ status: "evaluated" })
      .eq("id", listingId);
    return false;
  }

  if (!result.sent) {
    await supabaseAdmin
      .from("listings")
      .update({ status: "evaluated" })
      .eq("id", listingId);
  }
  return result;
}
