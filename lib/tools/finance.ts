import type { FinanceEvalResult } from "@/types";

function getMortgageRate(): number {
  const raw = process.env.MORTGAGE_RATE ?? "4.5";
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 15) {
    console.error(
      `Invalid MORTGAGE_RATE "${raw}", falling back to default 4.5%`,
    );
    return 4.5;
  }
  return parsed;
}

export function calculateFinance(
  price: number,
  deposit: number,
): Promise<FinanceEvalResult> {
  const rate = getMortgageRate();
  const mortgageRate = rate / 100 / 12;
  const loanAmount = price - deposit;
  const termMonths = 25 * 12;

  const validInputs =
    Number.isFinite(price) && price >= 0 && Number.isFinite(deposit) && deposit >= 0;

  if (!validInputs) {
    const raw = {
      price,
      deposit,
      loan_amount: loanAmount,
      rate_used: rate,
      term_years: 25,
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
    const raw = {
      price,
      deposit,
      loan_amount: loanAmount,
      rate_used: rate,
      term_years: 25,
      reason: "no borrowing required",
    };

    return Promise.resolve({
      monthly_mortgage: 0,
      monthly_interest_only: 0,
      stamp_duty: calculateSDLT(price, true),
      estimated_monthly_total: 200,
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
  const estimated_monthly_total = monthly_mortgage + 200;

  const raw = {
    price,
    deposit,
    loan_amount: loanAmount,
      rate_used: rate,
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
