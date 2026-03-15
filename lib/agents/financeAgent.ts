import type { FinanceEvalResult } from "@/types";

export function financeAgent(
  price: number,
  deposit: number
): Promise<FinanceEvalResult> {
  const mortgageRate =
    parseFloat(process.env.MORTGAGE_RATE ?? "4.5") / 100 / 12;
  const loanAmount = price - deposit;
  const termMonths = 25 * 12;

  // Repayment mortgage monthly payment
  const monthly_mortgage =
    loanAmount > 0
      ? (loanAmount * mortgageRate * Math.pow(1 + mortgageRate, termMonths)) /
        (Math.pow(1 + mortgageRate, termMonths) - 1)
      : 0;

  // Interest-only monthly payment
  const annualRate = parseFloat(process.env.MORTGAGE_RATE ?? "4.5") / 100;
  const monthly_interest_only =
    loanAmount > 0 ? (loanAmount * annualRate) / 12 : 0;

  // Stamp Duty Land Tax (SDLT) — first-time buyer relief
  const stamp_duty = calculateSDLT(price, true);

  // Estimated monthly total (mortgage + service charge estimate £200/mo)
  const estimated_monthly_total = monthly_mortgage + 200;

  const raw = {
    price,
    deposit,
    loan_amount: loanAmount,
    rate_used: parseFloat(process.env.MORTGAGE_RATE ?? "4.5"),
    term_years: 25,
  };

  return Promise.resolve({
    monthly_mortgage: Math.round(monthly_mortgage),
    monthly_interest_only: Math.round(monthly_interest_only),
    stamp_duty: Math.round(stamp_duty),
    estimated_monthly_total: Math.round(estimated_monthly_total),
    raw,
  });
}

function calculateSDLT(price: number, firstTimeBuyer: boolean): number {
  if (firstTimeBuyer) {
    // First-time buyer relief: 0% up to £425k, 5% on £425k-£625k, standard above £625k
    if (price <= 425000) return 0;
    if (price <= 625000) return (price - 425000) * 0.05;
    // Above £625k threshold, FTB relief does not apply — use standard rates
  }

  // Standard SDLT rates
  let tax = 0;
  if (price > 1500000) tax += (price - 1500000) * 0.12;
  if (price > 925000) tax += (Math.min(price, 1500000) - 925000) * 0.1;
  if (price > 250000) tax += (Math.min(price, 925000) - 250000) * 0.05;
  // 0% on first £250k (standard threshold from Sept 2022)

  return tax;
}
