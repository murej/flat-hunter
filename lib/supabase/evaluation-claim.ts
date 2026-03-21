import { supabaseAdmin } from "@/lib/supabase";
import { envIntClamped } from "@/lib/utils/env-utils";

export function getEvaluatingStaleMinutes(): number {
  return envIntClamped("EVALUATING_STALE_MINUTES", 5, 120, 15);
}

export async function claimListingsForEvaluationBatch(
  batchLimit: number,
  staleMinutes: number,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc("claim_listings_for_evaluation", {
    p_batch_limit: batchLimit,
    p_stale_minutes: staleMinutes,
  });
  if (error) throw error;
  if (!data) return [];
  return data as string[];
}

export async function claimListingForEvaluation(
  id: string,
  staleMinutes: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_listing_for_evaluation", {
    p_id: id,
    p_stale_minutes: staleMinutes,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseListingEvaluationClaim(id: string): Promise<void> {
  await supabaseAdmin
    .from("listings")
    .update({ status: "pending_evaluation", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "evaluating");
}
