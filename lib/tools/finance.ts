import type { FinanceEvalResult } from "@/types";
import { getLatestMortgageRate } from "./mortgage-rate";

const MORTGAGE_TERM_YEARS = 25;
const STRESS_TEST_MARGIN = 2;
const SERVICE_CHARGE_MONTHLY = 200;

const FTB_PRICE_CAP = 625_000;
const FTB_BANDS = [
  { threshold: 425_000, rate: 0 },
  { threshold: 625_000, rate: 0.05 },
];
const STANDARD_BANDS = [
  { threshold: 250_000, rate: 0 },
  { threshold: 925_000, rate: 0.05 },
  { threshold: 1_500_000, rate: 0.1 },
  { threshold: Infinity, rate: 0.12 },
];

function calculateSDLT(price: number, firstTimeBuyer = true): number {
  const ftbEligible = firstTimeBuyer && price <= FTB_PRICE_CAP;
  const bands = ftbEligible ? FTB_BANDS : STANDARD_BANDS;

  let tax = 0;
  let prev = 0;
  for (const band of bands) {
    if (price <= prev) break;
    const taxable = Math.min(price, band.threshold) - prev;
    if (taxable > 0) tax += taxable * band.rate;
    prev = band.threshold;
  }
  return Math.round(tax);
}

function calculateMonthlyRepayment(
  principal: number,
  annualRate: number,
  years: number,
): number {
  const monthlyRate = annualRate / 100 / 12;
  const n = years * 12;
  if (monthlyRate === 0) return principal / n;
  const payment =
    (principal * (monthlyRate * Math.pow(1 + monthlyRate, n))) /
    (Math.pow(1 + monthlyRate, n) - 1);
  return Math.round(payment);
}

export async function evaluateFinance(
  price: number,
  deposit: number,
): Promise<FinanceEvalResult> {
  const rate = await getLatestMortgageRate();
  const loanAmount = price - deposit;

  const mortgageMonthly = calculateMonthlyRepayment(loanAmount, rate, MORTGAGE_TERM_YEARS);
  const interestOnlyMonthly = Math.round((loanAmount * rate) / 100 / 12);
  const stampDuty = calculateSDLT(price);
  const stressTestMonthly = calculateMonthlyRepayment(
    loanAmount,
    rate + STRESS_TEST_MARGIN,
    MORTGAGE_TERM_YEARS,
  );
  const totalMonthly = mortgageMonthly + SERVICE_CHARGE_MONTHLY;

  return {
    mortgage_monthly: mortgageMonthly,
    interest_only_monthly: interestOnlyMonthly,
    stamp_duty: stampDuty,
    stress_test_monthly: stressTestMonthly,
    total_monthly: totalMonthly,
  };
}
