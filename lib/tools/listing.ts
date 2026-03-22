import { getSupabaseAdmin, getListing } from "@/lib/supabase";
import type { Listing, Evaluation, ListingStatus, Preferences } from "@/types";

const FIND_LISTINGS_DEFAULT_LIMIT = 12;
const FIND_LISTINGS_MAX_LIMIT = 25;
const FIND_LISTINGS_FETCH_CAP = 100;

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "bed",
  "beds",
  "bedroom",
  "bedrooms",
  "flat",
  "for",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
]);

export type ListingSearchRow = {
  id: string;
  title: string;
  address: string;
  postcode: string;
  price: number;
  status: string;
  bedrooms: number;
  created_at: string;
};

export type FindListingsResult = {
  rows: ListingSearchRow[];
  totalAfterFilter: number;
  cappedAtFetch: boolean;
};

function escapeIlikePattern(fragment: string): string {
  return fragment.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function tokenizeListingQuery(query: string): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];

  const parts = raw
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  const tokens = parts.filter((t) => t.length >= 2 && !QUERY_STOPWORDS.has(t));

  if (tokens.length === 0 && raw.length >= 2) {
    return [raw];
  }

  return tokens;
}

function rowMatchesAllTokens(
  row: Record<string, unknown>,
  tokens: string[],
): boolean {
  const hay = [row.title, row.address, row.postcode, row.portal_id]
    .map((s) => String(s ?? "").toLowerCase())
    .join(" ");
  return tokens.every((t) => hay.includes(t.toLowerCase()));
}

export async function findListingsByQuery(
  query: string,
  options?: { limit?: number; status?: ListingStatus | "any" },
): Promise<FindListingsResult> {
  const tokens = tokenizeListingQuery(query);
  if (tokens.length === 0) {
    return { rows: [], totalAfterFilter: 0, cappedAtFetch: false };
  }

  const limit = Math.min(
    Math.max(1, options?.limit ?? FIND_LISTINGS_DEFAULT_LIMIT),
    FIND_LISTINGS_MAX_LIMIT,
  );

  // Commas break PostgREST `or()` argument parsing if left inside unquoted patterns.
  const first = tokens[0]!.replace(/,/g, " ").trim();
  if (!first) {
    return { rows: [], totalAfterFilter: 0, cappedAtFetch: false };
  }
  const pattern = `%${escapeIlikePattern(first)}%`;
  const orClause = `title.ilike.${pattern},address.ilike.${pattern},postcode.ilike.${pattern},portal_id.ilike.${pattern}`;

  let dbQuery = getSupabaseAdmin()
    .from("listings")
    .select("id, title, address, postcode, price, status, bedrooms, created_at, portal_id")
    .or(orClause)
    .order("created_at", { ascending: false })
    .limit(FIND_LISTINGS_FETCH_CAP);

  if (options?.status && options.status !== "any") {
    dbQuery = dbQuery.eq("status", options.status);
  }

  const { data, error } = await dbQuery;

  if (error) {
    console.error("findListingsByQuery:", error.message);
    return { rows: [], totalAfterFilter: 0, cappedAtFetch: false };
  }

  const fetched = (data ?? []) as Record<string, unknown>[];
  const cappedAtFetch = fetched.length >= FIND_LISTINGS_FETCH_CAP;

  const filtered = fetched.filter((row) => rowMatchesAllTokens(row, tokens));
  const totalAfterFilter = filtered.length;

  const rows = filtered
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      address: String(r.address ?? ""),
      postcode: String(r.postcode ?? ""),
      price: Number(r.price ?? 0),
      status: String(r.status ?? ""),
      bedrooms: Number(r.bedrooms ?? 0),
      created_at: String(r.created_at ?? ""),
    }));

  return { rows, totalAfterFilter, cappedAtFetch };
}

export function formatFindListingsForTool(result: FindListingsResult): string {
  if (result.rows.length === 0) {
    return "No listings matched that search. Try different keywords (address, postcode, or area), or ask for your saved list.";
  }

  const lines = result.rows.map(
    (r, i) =>
      `${i + 1}. *${r.title}* — £${r.price.toLocaleString("en-GB")} — 🛏 ${r.bedrooms} — ${r.status}\n   📍 ${r.address}${r.postcode ? `, ${r.postcode}` : ""}\n   ID: \`${r.id}\``,
  );

  const parts = [lines.join("\n\n")];
  if (result.totalAfterFilter > result.rows.length) {
    parts.push(
      `\n_Showing ${result.rows.length} of ${result.totalAfterFilter} matches._`,
    );
  }
  if (result.cappedAtFetch) {
    parts.push(
      "\n_More properties may exist; results were capped. Ask for a narrower search if needed._",
    );
  }
  return parts.join("");
}
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
  await getSupabaseAdmin()
    .from("listings")
    .update({ status: "saved", updated_at: new Date().toISOString() })
    .eq("id", id);
  return `Listing ${id} saved.`;
}

export async function getScorecard(
  id: string,
): Promise<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> } | null> {
  const listing = await getListing(id);
  if (!listing) return null;

  const { data: evaluation } = await getSupabaseAdmin()
    .from("evaluations")
    .select("*")
    .eq("listing_id", id)
    .single();

  if (!evaluation) {
    return {
      text: buildNoScoreScorecardText(listing),
      buttons: buildScorecardButtons(id),
    };
  }

  const rate = await getLatestMortgageRate();
  return {
    text: buildScorecardText(listing, evaluation as Evaluation, rate),
    buttons: buildScorecardButtons(id),
  };
}

export async function getWhyContext(
  id: string,
): Promise<{ listing: Listing; evaluation: Evaluation; preferences: Preferences } | null> {
  const listing = await getListing(id);
  if (!listing) return null;

  const { data: evaluation } = await getSupabaseAdmin()
    .from("evaluations")
    .select("*")
    .eq("listing_id", id)
    .single();
  if (!evaluation) return null;

  const { data: preferences } = await getSupabaseAdmin()
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

    const { data: evaluation } = await getSupabaseAdmin()
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
  const { data } = await getSupabaseAdmin()
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
  const { data } = await getSupabaseAdmin()
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
