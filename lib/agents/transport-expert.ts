import { evaluateCommute } from "@/lib/tools/commute";

/**
 * Transport expert: uses domain logic (TfL API) for commute scoring.
 * Can be extended with runAgent + web_search for richer analysis.
 */
export async function runTransportExpert(
  fromPostcode: string,
  toPostcode: string,
  maxCommuteMinutes: number,
  address?: string,
) {
  return evaluateCommute(
    fromPostcode,
    toPostcode,
    maxCommuteMinutes,
    address,
  );
}
