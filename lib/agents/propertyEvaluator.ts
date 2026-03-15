import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, getListing, getPreferences } from "@/lib/supabase";
import { PROPERTY_EVALUATOR_SYSTEM } from "@/lib/prompts";
import { areaEvaluator } from "./areaEvaluator";
import { commuteEvaluator } from "./commuteEvaluator";
import { financeAgent } from "./financeAgent";
import { scorecardComposer } from "./scorecardComposer";
import type { PropertyEvalResult } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SCORE_THRESHOLD = 5;

export async function propertyEvaluator(
  listingId: string
): Promise<PropertyEvalResult> {
  const listing = await getListing(listingId);
  const preferences = await getPreferences();

  if (!preferences) {
    throw new Error("No preferences found — cannot evaluate listing");
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: PROPERTY_EVALUATOR_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Property:\n${JSON.stringify(listing, null, 2)}\n\nPreferences:\n${JSON.stringify(preferences, null, 2)}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) throw new Error("No JSON in property evaluator response");

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    price_score: parsed.price_score ?? 5,
    size_score: parsed.size_score ?? 5,
    fit_score: parsed.fit_score ?? 5,
    deal_breaker_flags: parsed.deal_breaker_flags ?? [],
    property_summary: parsed.property_summary ?? "",
    raw: parsed,
  };
}

export async function runEvaluationPipeline(listingId: string): Promise<boolean> {
  const listing = await getListing(listingId);
  const preferences = await getPreferences();

  const propertyResult = await propertyEvaluator(listingId);

  const [areaResult, commuteResult, financeResult] = await Promise.all([
    areaEvaluator(listing.postcode || listing.address).catch((e) => {
      console.error("Area evaluator failed:", e);
      return {
        area_score: 0,
        area_summary: "Area evaluation unavailable",
        notable_flags: [],
        raw: {},
      };
    }),
    commuteEvaluator(
      listing.postcode,
      preferences?.commute_anchor_postcode ?? "",
      preferences?.max_commute_minutes ?? 60
    ).catch((e) => {
      console.error("Commute evaluator failed:", e);
      return {
        commute_minutes: 0,
        commute_route: "Commute data unavailable",
        commute_score: 0,
      };
    }),
    financeAgent(listing.price, preferences?.deposit ?? 0).catch((e) => {
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

  const overall_score =
    (propertyResult.price_score +
      propertyResult.size_score +
      propertyResult.fit_score +
      areaResult.area_score +
      commuteResult.commute_score) /
    5;

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
      commute_minutes: commuteResult.commute_minutes,
      commute_route: commuteResult.commute_route,
      monthly_mortgage: financeResult.monthly_mortgage,
      monthly_interest_only: financeResult.monthly_interest_only,
      stamp_duty: financeResult.stamp_duty,
      estimated_monthly_total: financeResult.estimated_monthly_total,
      property_summary: propertyResult.property_summary,
      area_summary: areaResult.area_summary,
      raw_property_eval: propertyResult.raw,
      raw_area_eval: areaResult.raw,
      raw_finance_eval: financeResult.raw,
    })
    .select()
    .single();

  if (error) throw error;

  await supabaseAdmin
    .from("listings")
    .update({ status: "evaluated" })
    .eq("id", listingId);

  if (overall_score > SCORE_THRESHOLD) {
    await scorecardComposer(
      evaluation,
      listing,
      areaResult.notable_flags,
      commuteResult.commute_minutes
    );
    return true;
  }

  return false;
}
