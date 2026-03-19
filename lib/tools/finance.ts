import type { FinanceEvalResult } from "@/types";
import type { MortgageRate } from "@/lib/tools/mortgage-rate";
import { getLatestMortgageRate } from "./mortgage-rate";

const ENV_MORTGAGE_RATE_RAW = process.env.MORTGAGE_RATE?.trim();
// Important: `Number("")` is `0`, which would incorrectly override the default.
// Treat empty/whitespace as "unset" so we fall back to DEFAULT_MORTGAGE_RATE.
const ENV_MORTGAGE_RATE = ENV_MORTGAGE_RATE_RAW
  ? Number(ENV_MORTGAGE_RATE_RAW)
  : NaN;
const DEFAULT_MORTGAGE_RATE = Number.isFinite(ENV_MORTGAGE_RATE)
  ? ENV_MORTGAGE_RATE
  : 4.5;
const MIN_MORTGAGE_RATE = 0.5;
const MAX_MORTGAGE_RATE = 15;
const DEFAULT_TERM_YEARS = 25;
const DEFAULT_MONTHLY_SERVICE_CHARGE = 200;

function normalizeMortgageRate(input: MortgageRate | null): {
  rate: number;
  source: string;
  raw: string;
  effective_date?: string;
  series_code?: string;
  series_name?: string;
} {
  // If env is set and numeric, it always overrides
  if (Number.isFinite(ENV_MORTGAGE_RATE)) {
    return {
      rate: ENV_MORTGAGE_RATE,
      source: "env",
      raw: String(ENV_MORTGAGE_RATE),
      effective_date: input?.effective_date,
      series_code: input?.series_code,
      series_name: input?.series_name,
    };
  }

  if (!input) {
    return {
      rate: DEFAULT_MORTGAGE_RATE,
      source: "default",
      raw: String(DEFAULT_MORTGAGE_RATE),
    };
  }

  const raw = input.raw_input ?? String(input.rate);
  let rate = input.rate;
  let source = input.source;

  if (!Number.isFinite(rate)) {
    console.error(
      `Invalid mortgage rate "${raw}", falling back to default ${DEFAULT_MORTGAGE_RATE}%`,
    );
    rate = DEFAULT_MORTGAGE_RATE;
    source = "invalid";
  }

  if (rate < MIN_MORTGAGE_RATE || rate > MAX_MORTGAGE_RATE) {
    const clamped = Math.min(
      Math.max(rate, MIN_MORTGAGE_RATE),
      MAX_MORTGAGE_RATE,
    );
    console.warn(
      `Mortgage rate "${rate}" out of bounds, clamped to ${clamped}% (allowed range ${MIN_MORTGAGE_RATE}-${MAX_MORTGAGE_RATE}%)`,
    );
    rate = clamped;
    if (source !== "supabase") {
      source = "clamped";
    }
  }

  return {
    rate,
    source,
    raw,
    effective_date: input.effective_date,
    series_code: input.series_code,
    series_name: input.series_name,
  };
}

export async function evaluateFinance(price: number, deposit: number) {
  const rate = await getLatestMortgageRate();
  return calculateFinance(price, deposit, rate);
}

export function calculateFinance(
  price: number,
  deposit: number,
  rateInput?: MortgageRate | null,
): Promise<FinanceEvalResult> {
  const {
    rate,
    source: rateSource,
    raw: rawRate,
    effective_date: rateEffectiveDate,
    series_code: rateSeriesCode,
    series_name: rateSeriesName,
  } = normalizeMortgageRate(rateInput ?? null);
  const mortgageRate = rate / 100 / 12;
  const loanAmount = price - deposit;
  const termYears = DEFAULT_TERM_YEARS;
  const termMonths = termYears * 12;

  const validInputs =
    Number.isFinite(price) &&
    Number.isFinite(deposit) &&
    price >= 0 &&
    deposit >= 0;

  if (!validInputs) {
    const raw = {
      price,
      deposit,
      loan_amount: loanAmount,
      rate_used: rate,
      rate_source: rateSource,
      raw_rate_input: rawRate,
      rate_effective_date: rateEffectiveDate,
      rate_series_code: rateSeriesCode,
      rate_series_name: rateSeriesName,
      term_years: termYears,
      reason: "invalid_inputs",
    };

    return Promise.resolve({
      monthly_mortgage: 0,
      monthly_interest_only: 0,
      stamp_duty: 0,
      estimated_monthly_total: 0,
      raw,
    });
  }

  if (loanAmount <= 0) {
    const reason =
      loanAmount === 0 ? "no_borrowing_required" : "deposit_exceeds_price";

    const raw = {
      price,
      deposit,
      loan_amount: loanAmount,
      rate_used: rate,
      rate_source: rateSource,
      raw_rate_input: rawRate,
      rate_effective_date: rateEffectiveDate,
      rate_series_code: rateSeriesCode,
      rate_series_name: rateSeriesName,
      term_years: termYears,
      reason,
    };

    return Promise.resolve({
      monthly_mortgage: 0,
      monthly_interest_only: 0,
      stamp_duty: calculateSDLT(price, true),
      estimated_monthly_total: DEFAULT_MONTHLY_SERVICE_CHARGE,
      raw,
    });
  }

  // Repayment mortgage monthly payment
  const monthly_mortgage =
    (loanAmount * mortgageRate * Math.pow(1 + mortgageRate, termMonths)) /
    (Math.pow(1 + mortgageRate, termMonths) - 1);

  // Interest-only monthly payment
  const annualRate = rate / 100;
  const monthly_interest_only = (loanAmount * annualRate) / 12;

  // Stamp Duty Land Tax (SDLT) — first-time buyer relief
  const stamp_duty = calculateSDLT(price, true);

  // Estimated monthly total (mortgage + service charge estimate £200/mo)
  const estimated_monthly_total =
    monthly_mortgage + DEFAULT_MONTHLY_SERVICE_CHARGE;

  const ltv = price > 0 ? loanAmount / price : 0;

  const stressRate = Math.min(rate + 2, MAX_MORTGAGE_RATE);
  const stressMonthlyRate = stressRate / 100 / 12;
  const stress_monthly_mortgage =
    (loanAmount *
      stressMonthlyRate *
      Math.pow(1 + stressMonthlyRate, termMonths)) /
    (Math.pow(1 + stressMonthlyRate, termMonths) - 1);

  const warnings: string[] = [];
  if (ltv > 0.9) {
    warnings.push("high_ltv");
  }
  if (rate >= 7) {
    warnings.push("high_rate");
  }

  const raw = {
    price,
    deposit,
    loan_amount: loanAmount,
    rate_used: rate,
    rate_source: rateSource,
    raw_rate_input: rawRate,
    rate_effective_date: rateEffectiveDate,
    rate_series_code: rateSeriesCode,
    rate_series_name: rateSeriesName,
    term_years: termYears,
    ltv,
    sdlt: stamp_duty,
    stress_rate_used: stressRate,
    stress_monthly_mortgage,
    warnings,
  };

  return Promise.resolve({
    monthly_mortgage: Math.round(monthly_mortgage),
    monthly_interest_only: Math.round(monthly_interest_only),
    stamp_duty: Math.round(stamp_duty),
    estimated_monthly_total: Math.round(estimated_monthly_total),
    raw,
  });
}

const SDLT_FTB_ZERO_THRESHOLD = 425000;
const SDLT_FTB_UPPER_THRESHOLD = 625000;

const SDLT_STANDARD_BANDS = [
  { threshold: 1500000, rate: 0.12 },
  { threshold: 925000, rate: 0.1 },
  { threshold: 250000, rate: 0.05 },
];

function calculateStandardSDLT(price: number): number {
  if (price <= 0) return 0;

  let tax = 0;
  for (const band of SDLT_STANDARD_BANDS) {
    if (price > band.threshold) {
      tax += (price - band.threshold) * band.rate;
      price = band.threshold;
    }
  }
  return tax;
}

function calculateSDLT(price: number, firstTimeBuyer: boolean): number {
  if (price <= 0) return 0;

  if (firstTimeBuyer) {
    // First-time buyer relief: 0% up to £425k, 5% on £425k-£625k, standard above £625k
    if (price <= SDLT_FTB_ZERO_THRESHOLD) return 0;
    if (price <= SDLT_FTB_UPPER_THRESHOLD) {
      return (price - SDLT_FTB_ZERO_THRESHOLD) * 0.05;
    }
    // Above £625k threshold, FTB relief does not apply — use standard rates
  }

  return calculateStandardSDLT(price);
}
