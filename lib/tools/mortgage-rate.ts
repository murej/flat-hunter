import { supabaseAdmin } from "@/lib/supabase";

export async function getLatestMortgageRate(): Promise<number> {
  // Priority: env > Supabase > default
  const envRate = process.env.MORTGAGE_RATE;
  if (envRate) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed)) return Math.max(0.5, Math.min(15, parsed));
  }

  const { data } = await supabaseAdmin
    .from("agent_context")
    .select("content")
    .eq("agent_id", "system")
    .eq("scope", "global")
    .eq("scope_value", "mortgage_rate")
    .single();

  if (data?.content && typeof data.content === "object") {
    const rate = (data.content as Record<string, unknown>).rate;
    if (typeof rate === "number") return Math.max(0.5, Math.min(15, rate));
  }

  return 4.5;
}
