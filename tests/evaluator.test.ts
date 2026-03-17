import assert from "node:assert";
import { runEvaluationPipeline } from "@/lib/tools/evaluator";
import { supabaseAdmin } from "@/lib/supabase";

export async function runEvaluatorSmokeTest(listingId: string) {
  const result = await runEvaluationPipeline(listingId, {
    sendImmediately: false,
  });
  assert.ok(result && typeof result === "object");
  if ("overall_score" in result) {
    assert.ok(result.overall_score >= 0 && result.overall_score <= 10);
  }
  const { data: evaluation } = await supabaseAdmin
    .from("evaluations")
    .select("*")
    .eq("listing_id", listingId)
    .maybeSingle();
  assert.ok(evaluation);
}

