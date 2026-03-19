import { calculateFinance } from "@/lib/tools/finance";
import { getLatestMortgageRate } from "@/lib/tools/mortgage-rate";

/**
 * Finance expert: uses domain logic for mortgage, stamp duty, monthly costs.
 * Can be extended with runAgent + web_search for market analysis.
 */
export async function runFinanceExpert(price: number, deposit: number) {
  const rate = await getLatestMortgageRate();
  return calculateFinance(price, deposit, rate);
}
