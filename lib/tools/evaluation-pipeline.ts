import pLimit from "p-limit";
import { supabaseAdmin, getListing, getPreferences } from "@/lib/supabase";
import { fetchAreaContext } from "@/lib/tools/area-context";
import { buildNoScoreScorecardText, buildScorecardText } from "@/lib/tools/scorecard";
import type { Evaluation, Listing } from "@/types";
import { runPropertyExpert } from "@/lib/agents/property-expert";
import { runAreaExpert } from "@/lib/agents/area-expert";
import { evaluateCommute } from "@/lib/tools/commute";
import { evaluateFinance } from "@/lib/tools/finance";
import { dbRead, dbWrite } from "@/lib/core/tools/db";

const SCORE_THRESHOLD = 1;

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

async function getAgentContext(
  agentId: string,
  scope: string,
  scopeValue: string | null,
): Promise<string | undefined> {
  const filters: Record<string, unknown> = { agent_id: agentId, scope };
  if (scopeValue != null && scopeValue !== "") {
    filters.scope_value = scopeValue;
  }
  const result = await dbRead("agent_context", filters, 1);
  if (!result.ok || result.data.length === 0) return undefined;
  const row = result.data[0] as { content?: { findings?: string } };
  return row?.content?.findings;
}

export async function runEvaluationPipeline(
  listingId: string,
): Promise<EvaluationPipelineResult> {
  const listing = await getListing(listingId);
  const preferences = await getPreferences();

  if (!preferences) {
    throw new Error("No preferences found — cannot evaluate listing");
  }

  const areaContext = await fetchAreaContext(
    listing.postcode ?? "",
    preferences.areas ?? [],
    listing.address,
  );

  const areaProfiles =
    (preferences.raw_json?.area_profiles as Record<string, unknown>) ?? {};
  const areaContextBlock = {
    postcode: areaContext.postcode,
    target_area_match: areaContext.target_area_match,
    target_areas: areaContext.target_areas,
    area_preferences: preferences.area_preferences ?? [],
    crime: areaContext.crime,
    imd: areaContext.imd,
    preferred_area_profiles: areaProfiles,
  };

  const areaScopeValue =
    listing.postcode ?? areaContext.postcode?.admin_district ?? "";

  const [propertyPrior, areaPrior] = await Promise.all([
    getAgentContext("property_expert", "listing_id", listingId),
    getAgentContext("area_expert", "postcode", areaScopeValue || "general"),
  ]);

  const limit = pLimit(3);

  const [propertyResult, areaResult, commuteResult, financeResult] =
    await Promise.all([
      limit(() =>
        runPropertyExpert(
          listing as unknown as Record<string, unknown>,
          preferences as unknown as Record<string, unknown>,
          propertyPrior,
        ).catch((e) => {
          console.error("Property expert failed:", e);
          return {
            price_score: 5,
            size_score: 5,
            fit_score: 5,
            deal_breaker_flags: [] as string[],
            property_summary: "Evaluation unavailable",
          };
        }),
      ),
      limit(() =>
        runAreaExpert(areaContextBlock, areaPrior).catch((e) => {
          console.error("Area expert failed:", e);
          return {
            area_score: 5,
            area_summary: "Evaluation unavailable",
            notable_flags: [] as string[],
          };
        }),
      ),
      limit(() =>
        evaluateCommute(
          listing.postcode ?? "",
          preferences.commute_anchor_postcode ?? "",
          preferences.max_commute_minutes ?? 60,
          listing.address,
        ).catch((e) => {
          console.error("Commute evaluation failed:", e);
          return {
            commute_minutes: 0,
            commute_route: "Commute data unavailable",
            commute_score: 0,
            commute_unknown: true as const,
          };
        }),
      ),
      limit(() =>
        evaluateFinance(listing.price, preferences.deposit ?? 0).catch((e) => {
          console.error("Finance evaluation failed:", e);
          return {
            monthly_mortgage: 0,
            monthly_interest_only: 0,
            stamp_duty: 0,
            estimated_monthly_total: 0,
            raw: {},
          };
        }),
      ),
    ]);

  await Promise.all([
    dbWrite("agent_context", "upsert", {
      agent_id: "property_expert",
      scope: "listing_id",
      scope_value: listingId,
      content: {
        findings: `${propertyResult.property_summary} [scores: p=${propertyResult.price_score} s=${propertyResult.size_score} f=${propertyResult.fit_score}]`,
      },
    }),
    dbWrite("agent_context", "upsert", {
      agent_id: "area_expert",
      scope: "postcode",
      scope_value: areaScopeValue || "general",
      content: {
        findings: `${areaResult.area_summary} [score: ${areaResult.area_score}]${areaResult.notable_flags.length ? ` [flags: ${areaResult.notable_flags.join(", ")}]` : ""}`,
      },
    }),
  ]);

  const weightsConfig = preferences.raw_json?.score_weights as
    | Record<string, number>
    | undefined;

  const components: Array<{
    key: "price" | "size" | "fit" | "area" | "commute";
    score: number;
  }> = [];

  components.push(
    { key: "price", score: propertyResult.price_score },
    { key: "size", score: propertyResult.size_score },
    { key: "fit", score: propertyResult.fit_score },
  );
  components.push({ key: "area", score: areaResult.area_score });
  if (!("commute_unknown" in commuteResult) || !commuteResult.commute_unknown) {
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
    return Math.max(0, Math.min(raw, 5));
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

  const commuteMinutes =
    "commute_minutes" in commuteResult ? commuteResult.commute_minutes : 0;
  const commuteRoute =
    "commute_route" in commuteResult ? commuteResult.commute_route : "";
  const commuteUnknown =
    "commute_unknown" in commuteResult && commuteResult.commute_unknown;

  const { data: evaluation, error } = await supabaseAdmin
    .from("evaluations")
    .insert({
      listing_id: listingId,
      price_score: propertyResult.price_score,
      size_score: propertyResult.size_score,
      fit_score: propertyResult.fit_score,
      area_score: areaResult.area_score,
      commute_score: commuteResult.commute_score,
      overall_score: Math.round(overall_score * 10) / 10,
      deal_breaker_flags: propertyResult.deal_breaker_flags,
      commute_minutes: commuteMinutes,
      commute_route: commuteRoute,
      monthly_mortgage: financeResult.monthly_mortgage,
      monthly_interest_only: financeResult.monthly_interest_only,
      stamp_duty: financeResult.stamp_duty,
      estimated_monthly_total: financeResult.estimated_monthly_total,
      property_summary: propertyResult.property_summary,
      area_summary: areaResult.area_summary,
      raw_property_eval: {
        price_score: propertyResult.price_score,
        size_score: propertyResult.size_score,
        fit_score: propertyResult.fit_score,
        deal_breaker_flags: propertyResult.deal_breaker_flags,
        property_summary: propertyResult.property_summary,
      },
      raw_area_eval: {
        area_score: areaResult.area_score,
        area_summary: areaResult.area_summary,
        notable_flags: areaResult.notable_flags,
      },
      raw_finance_eval: financeResult.raw,
    })
    .select()
    .single();

  if (error) throw error;

  const unknownScores = {
    property: false,
    area: false,
    commute: commuteUnknown,
  };

  const scorecardText =
    components.length === 0
      ? buildNoScoreScorecardText(evaluation, listing)
      : buildScorecardText(
          evaluation,
          listing,
          areaResult.notable_flags,
          commuteMinutes,
          unknownScores,
        );

  const result: EvaluationPipelineResult = {
    sent: components.length === 0 || overall_score > SCORE_THRESHOLD,
    evaluation,
    listing,
    overall_score,
    notable_flags: areaResult.notable_flags,
    commute_minutes: commuteMinutes,
    unknownScores,
    shouldSendNoScore: components.length === 0,
    scorecardText,
  };

  await supabaseAdmin
    .from("listings")
    .update({ status: "evaluated" })
    .eq("id", listingId)
    .eq("status", "pending_evaluation");

  return result;
}
