import {
  supabaseAdmin,
  updateListingStatus,
  getPreferences,
} from "@/lib/supabase";
import {
  buildScorecardText,
  buildNoScoreScorecardText,
  buildScorecardButtons,
  type ScorecardButton,
} from "@/lib/tools/scorecard";
import type { Evaluation, Listing } from "@/types";

/** Columns needed for LLM explanations; excludes raw_* jsonb blobs. */
const EVALUATION_CONTEXT_COLUMNS =
  "id, listing_id, created_at, price_score, size_score, fit_score, area_score, commute_score, overall_score, deal_breaker_flags, commute_minutes, commute_route, monthly_mortgage, monthly_interest_only, stamp_duty, estimated_monthly_total, property_summary, area_summary, property_scores_unknown, area_score_unknown, commute_score_unknown";

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function saveListing(listingId: string): Promise<void> {
  await updateListingStatus(listingId, "saved");
}

export async function skipListing(listingId: string): Promise<void> {
  await updateListingStatus(listingId, "dismissed");
}

export type GetScorecardResult =
  | { ok: true; scorecardText: string; buttons: ScorecardButton[][]; listingId: string }
  | { ok: false; message: string };

export async function getScorecard(
  listingId: string,
): Promise<GetScorecardResult> {
  const [
    { data: evaluation },
    { data: listing },
  ] = await Promise.all([
    supabaseAdmin
      .from("evaluations")
      .select(
        "price_score, size_score, fit_score, area_score, commute_score, overall_score, deal_breaker_flags, commute_minutes, monthly_mortgage, property_summary, area_summary, property_scores_unknown, area_score_unknown, commute_score_unknown",
      )
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin
      .from("listings")
      .select("status, title, price, url, address, bedrooms, bathrooms, sqft, description, image_urls, floorplan_url, agent_name, agent_email, listed_date")
      .eq("id", listingId)
      .single(),
  ]);

  if (!evaluation || !listing) {
    return {
      ok: false,
      message:
        "I couldn't find a scorecard for that property — it may not have been evaluated yet.",
    };
  }

  const unknownScores = {
    property: !!(evaluation as { property_scores_unknown?: boolean }).property_scores_unknown,
    area: !!(evaluation as { area_score_unknown?: boolean }).area_score_unknown,
    commute: !!(evaluation as { commute_score_unknown?: boolean }).commute_score_unknown,
  };

  const allUnknown =
    unknownScores.property && unknownScores.area && unknownScores.commute;
  const hasScores =
    !allUnknown &&
    typeof evaluation.overall_score === "number" &&
    typeof evaluation.price_score === "number";
  const scorecardText = hasScores
    ? buildScorecardText(
        evaluation as unknown as Evaluation,
        listing as Listing,
        [],
        evaluation.commute_minutes ?? 0,
        unknownScores,
      )
    : buildNoScoreScorecardText(
        evaluation as unknown as Evaluation,
        listing as Listing,
      );
  const buttons = buildScorecardButtons(
    listingId,
    (listing as { status?: string }).status === "saved",
  );

  return {
    ok: true,
    scorecardText,
    buttons,
    listingId,
  };
}

export type GetWhyContextResult =
  | { ok: true; context: string; listing: Record<string, unknown>; evaluation: Record<string, unknown> }
  | { ok: false; error: string };

export async function getWhyContext(
  listingId: string,
): Promise<GetWhyContextResult> {
  const [{ data: listing }, { data: evaluation }] = await Promise.all([
    supabaseAdmin
      .from("listings")
      .select("title, address, price, url")
      .eq("id", listingId)
      .single(),
    supabaseAdmin
      .from("evaluations")
      .select(EVALUATION_CONTEXT_COLUMNS)
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (!evaluation) {
    return { ok: false, error: "No evaluation found for this property" };
  }

  const context = listing
    ? `Property: ${listing.title} at ${listing.address} (£${(listing.price as number)?.toLocaleString()})\n\nEvaluation: ${compactJson(evaluation)}`
    : `Evaluation: ${compactJson(evaluation)}`;

  return {
    ok: true,
    context,
    listing: (listing ?? {}) as Record<string, unknown>,
    evaluation: evaluation as Record<string, unknown>,
  };
}

export type GetFormattedPreferencesResult =
  | { ok: true; message: string; buttons: ScorecardButton[][] }
  | { ok: false };

export async function getFormattedPreferences(): Promise<GetFormattedPreferencesResult> {
  const p = await getPreferences();
  if (!p) return { ok: false };

  const prefs = p as {
    areas?: string[];
    max_price?: number;
    deposit?: number;
    min_bedrooms?: number;
    commute_anchor?: string;
    commute_anchor_postcode?: string;
    max_commute_minutes?: number;
    must_haves?: string[];
    deal_breakers?: string[];
    style_notes?: string;
    area_preferences?: string[];
  };

  const message = [
    `📋 *Your current preferences:*`,
    ``,
    `📍 *Areas:* ${prefs.areas?.join(", ") || "Not set"}`,
    `💰 *Max price:* £${prefs.max_price?.toLocaleString() || "Not set"}`,
    `💵 *Deposit:* £${prefs.deposit?.toLocaleString() || "Not set"}`,
    `🛏 *Min bedrooms:* ${prefs.min_bedrooms || "Not set"}`,
    `🚇 *Commute to:* ${prefs.commute_anchor_postcode || prefs.commute_anchor || "Not set"} (max ${prefs.max_commute_minutes} min)`,
    `✅ *Must-haves:* ${prefs.must_haves?.join(", ") || "None specified"}`,
    `❌ *Deal-breakers:* ${prefs.deal_breakers?.join(", ") || "None specified"}`,
    `🏘 *Area preferences:* ${prefs.area_preferences?.join(", ") || "None specified"}`,
    `🏠 *Style:* ${prefs.style_notes || "Not set"}`,
    ``,
  ].join("\n");

  const buttons: ScorecardButton[][] = [
    [{ text: "Update", callback_data: "update preferences" }],
  ];

  return { ok: true, message, buttons };
}

export type SavedListing = { id: string; title: string; price: number; address: string; url: string };

export type GetFormattedSavedListResult =
  | { ok: true; message: string; savedListings: SavedListing[] }
  | { ok: false; message: string };

export async function getFormattedSavedList(): Promise<GetFormattedSavedListResult> {
  const { data: listings } = await supabaseAdmin
    .from("listings")
    .select("id, title, price, address, url")
    .eq("status", "saved")
    .order("created_at", { ascending: false });

  if (!listings || listings.length === 0) {
    return { ok: false, message: "You haven't saved any properties yet." };
  }

  const list = listings
    .map(
      (
        l: { title: string; price: number; address: string; url: string },
        i: number,
      ) =>
        `${i + 1}. *${l.title}*\n   £${l.price?.toLocaleString()} · ${l.address}\n   [🔗 View listing](${l.url})`,
    )
    .join("\n\n");

  const message = `⭐️ *Your saved properties:*\n\n${list}`;
  const savedListings = listings as SavedListing[];

  return { ok: true, message, savedListings };
}

export type GetComparisonDataResult =
  | { ok: true; data: string }
  | { ok: false; message: string };

export async function getComparisonData(
  listingIdA: string,
  listingIdB: string,
): Promise<GetComparisonDataResult> {
  const [
    { data: evalA },
    { data: evalB },
    { data: listingA },
    { data: listingB },
  ] = await Promise.all([
    supabaseAdmin
      .from("evaluations")
      .select(EVALUATION_CONTEXT_COLUMNS)
      .eq("listing_id", listingIdA)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin
      .from("evaluations")
      .select(EVALUATION_CONTEXT_COLUMNS)
      .eq("listing_id", listingIdB)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin
      .from("listings")
      .select("title, address, price")
      .eq("id", listingIdA)
      .single(),
    supabaseAdmin
      .from("listings")
      .select("title, address, price")
      .eq("id", listingIdB)
      .single(),
  ]);

  const labelA = listingA
    ? `${listingA.title} (${listingA.address})`
    : listingIdA;
  const labelB = listingB
    ? `${listingB.title} (${listingB.address})`
    : listingIdB;

  if (!evalA || !evalB) {
    return { ok: false, message: "Could not find evaluations for both properties." };
  }

  const data = `Property A — ${labelA}:\n${compactJson(evalA)}\n\nProperty B — ${labelB}:\n${compactJson(evalB)}`;
  return { ok: true, data };
}

export const UPDATE_PREFERENCES_BUTTONS: ScorecardButton[][] = [
  [
    { text: "📍 Areas", callback_data: "update:areas" },
    { text: "💰 Budget", callback_data: "update:budget" },
    { text: "🛏 Bedrooms", callback_data: "update:bedrooms" },
  ],
  [
    { text: "🚇 Commute", callback_data: "update:commute" },
    { text: "✅ Must-haves", callback_data: "update:must_haves" },
    { text: "❌ Deal-breakers", callback_data: "update:deal_breakers" },
  ],
  [{ text: "Other / Everything", callback_data: "update:other" }],
];
