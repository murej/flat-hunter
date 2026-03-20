import type { FinanceEvalResult } from "@/types";
import { getLatestMortgageRate } from "./mortgage-rate";

function calculateSDLT(price: number): number {
  // Standard SDLT bands (non-FTB for now, simplified)
  const bands = [
    { threshold: 250_000, rate: 0 },
    { threshold: 925_000, rate: 0.05 },
    { threshold: 1_500_000, rate: 0.1 },
    { threshold: Infinity, rate: 0.12 },
  ];

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

  const mortgageMonthly = calculateMonthlyRepayment(loanAmount, rate, 25);
  const interestOnlyMonthly = Math.round((loanAmount * rate) / 100 / 12);
  const stampDuty = calculateSDLT(price);
  const stressTestMonthly = calculateMonthlyRepayment(
    loanAmount,
    rate + 2,
    25,
  );
  const serviceCharge = 200;
  const totalMonthly = mortgageMonthly + serviceCharge;

  return {
    mortgage_monthly: mortgageMonthly,
    interest_only_monthly: interestOnlyMonthly,
    stamp_duty: stampDuty,
    stress_test_monthly: stressTestMonthly,
    total_monthly: totalMonthly,
  };
}
