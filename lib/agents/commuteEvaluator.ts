import type { CommuteEvalResult } from "@/types";

const TFL_BASE = "https://api.tfl.gov.uk/journey/journeyresults";

export async function commuteEvaluator(
  fromPostcode: string,
  toPostcode: string,
  maxCommuteMinutes: number
): Promise<CommuteEvalResult> {
  const postcodeRe = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
  const regexPassed = postcodeRe.test((fromPostcode || '').trim());
  if (!fromPostcode || !toPostcode || !regexPassed) {
    return {
      commute_minutes: 0,
      commute_route: "Commute time unknown",
      commute_score: 0,
      commute_unknown: true,
    };
  }

  const from = encodeURIComponent(fromPostcode);
  const to = encodeURIComponent(toPostcode);
  const appId = process.env.TFL_APP_ID ?? "";
  const appKey = process.env.TFL_APP_KEY ?? "";

  const params = new URLSearchParams();
  if (appId) params.set("app_id", appId);
  if (appKey) params.set("app_key", appKey);

  const url = `${TFL_BASE}/${from}/to/${to}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TfL API error: ${res.status}`);
  }

  const data = await res.json();
  const journeys = data.journeys as Array<{
    duration: number;
    legs: Array<{ instruction?: { summary?: string } }>;
  }>;

  if (!journeys || journeys.length === 0) {
    return {
      commute_minutes: 0,
      commute_route: "No journey found",
      commute_score: 0,
    };
  }

  const fastest = journeys[0];
  const commuteMinutes = fastest.duration;

  const routeSummary = fastest.legs
    .map((leg) => leg.instruction?.summary || "")
    .filter(Boolean)
    .join(" → ");

  const commuteScore = scoreCommute(commuteMinutes, maxCommuteMinutes);

  return {
    commute_minutes: commuteMinutes,
    commute_route: routeSummary || `${commuteMinutes} min journey`,
    commute_score: commuteScore,
  };
}

function scoreCommute(minutes: number, maxMinutes: number): number {
  if (minutes <= maxMinutes * 0.5) return 10;
  if (minutes <= maxMinutes * 0.75) return 8;
  if (minutes <= maxMinutes) return 6;
  if (minutes <= maxMinutes * 1.25) return 4;
  if (minutes <= maxMinutes * 1.5) return 2;
  return 1;
}
