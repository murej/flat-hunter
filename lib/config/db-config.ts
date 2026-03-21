import { supabaseAdmin } from "@/lib/supabase";
import type { DbToolConfig } from "@/lib/core/tools";

function truncateField(val: string, max: number): string {
  return val.length > max ? val.slice(0, max) + "..." : val;
}

type Row = Record<string, unknown>;

export const dbConfig: DbToolConfig = {
  supabaseClient: supabaseAdmin,
  allowlistedTables: [
    "preferences",
    "listings",
    "evaluations",
    "conversations",
    "agent_context",
  ],
  columnOverrides: {
    listings:
      "id, portal_id, url, title, price, address, postcode, bedrooms, bathrooms, sqft, agent_name, listed_date, status, created_at",
    evaluations:
      "id, listing_id, price_score, size_score, fit_score, commute_score, area_score, overall_score, deal_breaker_flags, commute_minutes, commute_route, mortgage_monthly, total_monthly, property_summary, area_summary, created_at",
  },
  rowShaping: {
    listings: (rows: unknown[]) =>
      (rows as Row[]).map((r) => ({
        ...r,
        description: r.description
          ? truncateField(r.description as string, 3500)
          : null,
      })),
    conversations: (rows: unknown[]) =>
      (rows as Row[]).map((r) => ({
        ...r,
        message: r.message
          ? truncateField(r.message as string, 1500)
          : null,
      })),
    agent_context: (rows: unknown[]) =>
      (rows as Row[]).map((r) => ({
        ...r,
        content: r.content
          ? truncateField(JSON.stringify(r.content), 2500)
          : null,
      })),
  },
};
