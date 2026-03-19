import Anthropic from "@anthropic-ai/sdk";
import {
  supabaseAdmin,
  getListing,
  getPreferences,
} from "@/lib/supabase";
import { retryWithBackoff } from "@/lib/utils/retry";
import { COMBINED_EVALUATOR_SYSTEM } from "./evaluator.prompts";
import { fetchAreaContext } from "./area-context";
import { evaluateCommute } from "./commute";
import { calculateFinance } from "./finance";
import { getLatestMortgageRate } from "./mortgage-rate";
import { buildNoScoreScorecardText, buildScorecardText } from "./scorecard";
import type { CombinedEvalResult, Evaluation, Listing } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCORE_THRESHOLD = 1;

function clampScore(score: unknown, fallback: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return fallback;
  if (score < 1) return 1;
  if (score > 10) return 10;
  return score;
}

function extractJsonObject(text: string): unknown {
  // Prefer the last JSON-looking object in the text – models sometimes
  // include reasoning before the final JSON.
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches || matches.length === 0) {
    throw new Error("No JSON in combined evaluator response");
  }
  const candidate = matches[matches.length - 1];
  return JSON.parse(candidate);
}

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
    (preferences.raw_json?.area_profiles as
      | Record<string, unknown>
      | undefined) ?? {};

  const areaPreferences = preferences.area_preferences ?? [];

  const areaContextBlock =
    areaContext.postcode ||
    areaContext.target_area_match !== null ||
    Object.keys(areaProfiles).length > 0 ||
    areaContext.crime ||
    areaContext.imd ||
    areaPreferences.length > 0
      ? `\n\nArea context:\n${JSON.stringify(
          {
            postcode: areaContext.postcode,
            target_area_match: areaContext.target_area_match,
            target_areas: areaContext.target_areas,
            area_preferences: areaPreferences,
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
          content: `Property:\n${JSON.stringify(
            listing,
            null,
            2,
          )}\n\nPreferences:\n${JSON.stringify(
            preferences,
            null,
            2,
          )}${areaContextBlock}`,
        },
      ],
    }),
  );

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("Combined evaluator response missing text content");
  }

  let parsed: any;
  try {
    parsed = extractJsonObject(firstBlock.text) as any;
  } catch (err) {
    console.error("Failed to parse combined evaluator JSON:", err);
    throw new Error("Invalid JSON in combined evaluator response");
  }

  const price_score = clampScore(parsed.price_score, 5);
  const size_score = clampScore(parsed.size_score, 5);
  const fit_score = clampScore(parsed.fit_score, 5);
  const area_score = clampScore(parsed.area_score, 5);

  const hasProperty =
    typeof parsed.price_score === "number" ||
    typeof parsed.size_score === "number" ||
    typeof parsed.fit_score === "number";
  const hasArea = typeof parsed.area_score === "number";

  const property_unknown =
    parsed.property_unknown === true || !hasProperty ? true : false;
  const area_unknown = parsed.area_unknown === true || !hasArea ? true : false;

  return {
    price_score,
    size_score,
    fit_score,
    deal_breaker_flags: Array.isArray(parsed.deal_breaker_flags)
      ? parsed.deal_breaker_flags
      : [],
    property_summary:
      typeof parsed.property_summary === "string"
        ? parsed.property_summary
        : "",
    area_score,
    area_summary:
      typeof parsed.area_summary === "string" ? parsed.area_summary : "",
    notable_flags: Array.isArray(parsed.notable_flags)
      ? parsed.notable_flags
      : [],
    property_unknown,
    area_unknown,
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
  scorecardText: string;
};

export async function runEvaluationPipeline(
  listingId: string,
): Promise<EvaluationPipelineResult> {
  const listing = await getListing(listingId);
  const preferences = await getPreferences();

  if (!preferences) {
    throw new Error("No preferences found — cannot evaluate listing");
  }

  const [combinedResult, commuteResult, financeResult] = await Promise.all([
    combinedEvaluator(listingId, preferences).catch((e) => {
      console.error("Combined evaluator failed:", e);
      return {
        price_score: 5,
        size_score: 5,
        fit_score: 5,
        property_unknown: true as const,
        deal_breaker_flags: [],
        property_summary: "",
        area_score: 5,
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
    getLatestMortgageRate()
      .then((rate) =>
        calculateFinance(listing.price, preferences?.deposit ?? 0, rate),
      )
      .catch((e) => {
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

  const weightsConfig = preferences.raw_json?.score_weights as
    | Record<string, number>
    | undefined;

  const components: Array<{
    key: "price" | "size" | "fit" | "area" | "commute";
    score: number;
  }> = [];

  if (!combinedResult.property_unknown) {
    components.push(
      { key: "price", score: combinedResult.price_score },
      { key: "size", score: combinedResult.size_score },
      { key: "fit", score: combinedResult.fit_score },
    );
  }
  if (!combinedResult.area_unknown) {
    components.push({ key: "area", score: combinedResult.area_score });
  }
  if (!commuteResult.commute_unknown) {
    components.push({ key: "commute", score: commuteResult.commute_score });
  }

  const rawWeights: Record<string, number> = {};
  if (weightsConfig && typeof weightsConfig === "object") {
    for (const [key, value] of Object.entries(weightsConfig)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        rawWeights[key] = value;
      }
    }
  }

  const getWeight = (key: string): number => {
    const raw = rawWeights[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
    const clamped = Math.max(0, Math.min(raw, 5));
    return clamped;
  };

  const overall_score =
    components.length > 0
      ? (() => {
          const weightedSum = components.reduce(
            (sum, { key, score }) => sum + score * getWeight(key),
            0,
          );
          const totalWeight = components.reduce(
            (sum, { key }) => sum + getWeight(key),
            0,
          );
          if (totalWeight <= 0) return 0;
          const avg = weightedSum / totalWeight;
          return Math.max(1, Math.min(10, avg));
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
    property: Boolean(combinedResult.property_unknown),
    area: Boolean(combinedResult.area_unknown),
    commute: Boolean(commuteResult.commute_unknown),
  };

  const scorecardText =
    components.length === 0
      ? buildNoScoreScorecardText(evaluation, listing)
      : buildScorecardText(
          evaluation,
          listing,
          combinedResult.notable_flags,
          commuteResult.commute_minutes,
          unknownScores,
        );

  const result: EvaluationPipelineResult = {
    sent: components.length === 0 || overall_score > SCORE_THRESHOLD,
    evaluation,
    listing,
    overall_score,
    notable_flags: combinedResult.notable_flags,
    commute_minutes: commuteResult.commute_minutes,
    unknownScores,
    shouldSendNoScore: components.length === 0,
    scorecardText,
  };

  // Mark as evaluated only when still pending (do not overwrite saved/dismissed)
  await supabaseAdmin
    .from("listings")
    .update({ status: "evaluated" })
    .eq("id", listingId)
    .eq("status", "pending_evaluation");

  return result;
}
