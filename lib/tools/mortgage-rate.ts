import { supabaseAdmin } from "@/lib/supabase";

export type MortgageRateSource =
  | "supabase"
  | "env"
  | "default"
  | "clamped"
  | "invalid";

export interface MortgageRate {
  rate: number;
  source: MortgageRateSource;
  raw_input?: string;
  effective_date?: string;
  series_code?: string;
  series_name?: string;
}

const ENV_MORTGAGE_RATE_RAW = process.env.MORTGAGE_RATE?.trim();
// Treat empty/whitespace as "unset" so it does not incorrectly become 0.
const ENV_MORTGAGE_RATE = ENV_MORTGAGE_RATE_RAW
  ? Number(ENV_MORTGAGE_RATE_RAW)
  : NaN;

export async function getLatestMortgageRate(): Promise<MortgageRate> {
  // If MORTGAGE_RATE is set and numeric, it always wins
  if (Number.isFinite(ENV_MORTGAGE_RATE)) {
    return {
      rate: ENV_MORTGAGE_RATE,
      source: "env",
      raw_input: ENV_MORTGAGE_RATE_RAW,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("mortgage_rates")
    .select("*")
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return {
      rate: Number(data.rate_annual_percent),
      source: "supabase",
      effective_date: data.effective_date,
      series_code: data.source_series,
      series_name: data.source_name,
    };
  }

  // Final safety fallback if nothing else works
  return { rate: 4.5, source: "invalid", raw_input: ENV_MORTGAGE_RATE_RAW };
}
