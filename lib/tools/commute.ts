import type { CommuteEvalResult } from "@/types";
import { retryWithBackoff } from "@/lib/utils/retry";

const TFL_BASE = "https://api.tfl.gov.uk/journey/journeyresults";
const fullPostcodeRe = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const outwardCodeRe = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

async function geocodeAddress(address: string): Promise<string | null> {
  try {
    const res = await retryWithBackoff(async () => {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=gb`,
        { headers: { "User-Agent": "flat-hunter/1.0" } },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    });
    const data = await res.json();
    if (!data?.[0]?.lat || !data?.[0]?.lon) return null;
    return `${data[0].lat},${data[0].lon}`;
  } catch {
    return null;
  }
}

async function resolveFromLocation(
  postcode: string,
  address?: string
): Promise<string | null> {
  if (fullPostcodeRe.test(postcode.trim())) return postcode.trim();

  if (address) {
    const coords = await geocodeAddress(address);
    if (coords) return coords;
  }

  if (outwardCodeRe.test(postcode.trim())) {
    try {
      const res = await retryWithBackoff(async () => {
        const r = await fetch(
          `https://api.postcodes.io/postcodes?q=${encodeURIComponent(postcode.trim())}&limit=1`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r;
      });
      const data = await res.json();
      return (data?.result?.[0]?.postcode as string) ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function evaluateCommute(
  fromPostcode: string,
  toPostcode: string,
  maxCommuteMinutes: number,
  address?: string
): Promise<CommuteEvalResult> {
  if (!fromPostcode || !toPostcode) {
    return {
      commute_minutes: 0,
      commute_route: "Commute time unknown",
      commute_score: 0,
      commute_unknown: true,
    };
  }

  const resolvedFrom = await resolveFromLocation(fromPostcode, address);

  if (!resolvedFrom) {
    return {
      commute_minutes: 0,
      commute_route: "Commute time unknown",
      commute_score: 0,
      commute_unknown: true,
    };
  }

  const from = encodeURIComponent(resolvedFrom);
  const to = encodeURIComponent(toPostcode);
  const appId = process.env.TFL_APP_ID ?? "";
  const appKey = process.env.TFL_APP_KEY ?? "";

  const params = new URLSearchParams();
  if (appId) params.set("app_id", appId);
  if (appKey) params.set("app_key", appKey);

  const url = `${TFL_BASE}/${from}/to/${to}?${params.toString()}`;

  const res = await retryWithBackoff(async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`TfL API error: ${r.status}`);
    return r;
  });

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
      commute_unknown: true,
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
