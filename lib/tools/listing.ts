import { supabaseAdmin, getListing } from "@/lib/supabase";
import type { Listing, Evaluation, Preferences } from "@/types";
import {
  buildScorecardText,
  buildScorecardButtons,
  buildNoScoreScorecardText,
} from "./scorecard";
import { getLatestMortgageRate } from "./mortgage-rate";

export const UPDATE_PREFERENCES_BUTTONS = [
  [
    { text: "📍 Areas", callback_data: "update:areas" },
    { text: "💰 Budget", callback_data: "update:budget" },
    { text: "🛏 Bedrooms", callback_data: "update:bedrooms" },
  ],
  [
    { text: "🚇 Commute", callback_data: "update:commute" },
    { text: "✅ Must-haves", callback_data: "update:must_haves" },
    { text: "🚫 Deal-breakers", callback_data: "update:deal_breakers" },
  ],
  [{ text: "📝 Update all", callback_data: "update preferences" }],
];

export async function saveListing(id: string): Promise<string> {
  await supabaseAdmin
    .from("listings")
    .update({ status: "saved", updated_at: new Date().toISOString() })
    .eq("id", id);
  return `Listing ${id} saved.`;
}

export async function skipListing(id: string): Promise<string> {
  await supabaseAdmin
    .from("listings")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("id", id);
  return `Listing ${id} skipped.`;
}

export async function getScorecard(
  id: string,
): Promise<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> } | null> {
  const listing = await getListing(id);
  if (!listing) return null;

  const { data: evaluation } = await supabaseAdmin
    .from("evaluations")
    .select("*")
    .eq("listing_id", id)
    .single();

  if (!evaluation) {
    return {
      text: buildNoScoreScorecardText(listing),
      buttons: buildScorecardButtons(id, false),
    };
  }

  const isSaved = listing.status === "saved";
  const rate = await getLatestMortgageRate();
  return {
    text: buildScorecardText(listing, evaluation as Evaluation, rate),
    buttons: buildScorecardButtons(id, isSaved),
  };
}

export async function getWhyContext(
  id: string,
): Promise<{ listing: Listing; evaluation: Evaluation; preferences: Preferences } | null> {
  const listing = await getListing(id);
  if (!listing) return null;

  const { data: evaluation } = await supabaseAdmin
    .from("evaluations")
    .select("*")
    .eq("listing_id", id)
    .single();
  if (!evaluation) return null;

  const { data: preferences } = await supabaseAdmin
    .from("preferences")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (!preferences) return null;

  return {
    listing: listing as Listing,
    evaluation: evaluation as Evaluation,
    preferences: preferences as Preferences,
  };
}

export async function getComparisonData(
  ids: string[],
): Promise<Array<{ listing: Listing; evaluation: Evaluation | null }>> {
  const results: Array<{ listing: Listing; evaluation: Evaluation | null }> = [];

  for (const id of ids) {
    const listing = await getListing(id);
    if (!listing) continue;

    const { data: evaluation } = await supabaseAdmin
      .from("evaluations")
      .select("*")
      .eq("listing_id", id)
      .single();

    results.push({
      listing: listing as Listing,
      evaluation: evaluation ? (evaluation as Evaluation) : null,
    });
  }

  return results;
}

export async function getFormattedSavedList(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("listings")
    .select("id, title, price, address, postcode, bedrooms, status")
    .eq("status", "saved")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return "No saved properties yet.";

  return data
    .map(
      (l: Record<string, unknown>, i: number) =>
        `${i + 1}. *${l.title}* — £${(l.price as number).toLocaleString("en-GB")}\n   📍 ${l.address} | 🛏 ${l.bedrooms} bed\n   ID: ${l.id}`,
    )
    .join("\n\n");
}

export async function getFormattedPreferences(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("preferences")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return "No preferences set. Use /start to set up.";

  const p = data as Preferences;
  const lines = [
    `📍 *Areas:* ${p.areas.join(", ")}`,
    `💰 *Max price:* £${p.max_price.toLocaleString("en-GB")}`,
    `🏦 *Deposit:* £${p.deposit.toLocaleString("en-GB")}`,
    `🛏 *Min bedrooms:* ${p.min_bedrooms}`,
    `🚇 *Commute:* ${p.commute_anchor} (${p.commute_postcode}), max ${p.commute_max_minutes} min`,
    `✅ *Must-haves:* ${p.must_haves.join(", ") || "None"}`,
    `🚫 *Deal-breakers:* ${p.deal_breakers.join(", ") || "None"}`,
  ];
  if (p.style_notes) lines.push(`🎨 *Style:* ${p.style_notes}`);
  if (p.freeform_notes) lines.push(`📝 *Notes:* ${p.freeform_notes}`);

  return lines.join("\n");
}
