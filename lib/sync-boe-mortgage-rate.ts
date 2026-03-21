import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Writes MORTGAGE_RATE (or default 4.5) to agent_context for finance scoring.
 * Used by GET /api/cron/sync-boe-mortgage-rate and npm run sync-rate.
 */
export async function syncMortgageRateFromEnv(): Promise<{ rate: number }> {
  const rate = parseFloat(process.env.MORTGAGE_RATE || "4.5");

  const { error } = await getSupabaseAdmin().from("agent_context").upsert(
    {
      agent_id: "system",
      scope: "global",
      scope_value: "mortgage_rate",
      content: { rate, updated_at: new Date().toISOString() },
    },
    { onConflict: "agent_id,scope,scope_value" },
  );

  if (error) {
    throw new Error(error.message);
  }

  return { rate };
}
