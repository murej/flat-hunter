import type { CommuteEvalResult } from "@/types";
import { retryWithBackoff, sleep } from "@/lib/utils/retry";

async function resolvePostcodeToCoords(
  postcode: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    // Try full postcode first
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as {
        result: { latitude: number; longitude: number } | null;
      };
      if (json.result) {
        return { lat: json.result.latitude, lon: json.result.longitude };
      }
    }

    // Fall back to outcode (partial postcode like "E3") for approximate coords
    const outcode = postcode.trim().split(/\s/)[0];
    const outRes = await fetch(
      `https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`,
    );
    if (outRes.ok) {
      const outJson = (await outRes.json()) as {
        result: { latitude: number; longitude: number } | null;
      };
      if (outJson.result) {
        console.error("[commute] using outcode fallback for", postcode, "->", outcode);
        return { lat: outJson.result.latitude, lon: outJson.result.longitude };
      }
    }

    console.error("[commute] postcodes.io failed for both postcode and outcode:", postcode);
    return null;
  } catch (err) {
    console.error("[commute] postcodes.io error for", postcode, err);
    return null;
  }
}

function simplifyAddress(address: string): string {
  // Strip unit/apartment/plot prefixes that confuse geocoders
  return address
    .replace(/^(apartment|flat|unit|plot|suite)\s*-?\s*\w+,?\s*/i, "")
    .trim();
}

async function resolveAddressToCoords(
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  await sleep(1100); // Nominatim rate limit
  try {
    // Try simplified address (strip apartment/plot prefixes)
    const simplified = simplifyAddress(address);
    const query = simplified !== address ? simplified : address;

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "User-Agent": "Stath/1.0" } },
    );
    if (!res.ok) {
      console.error("[commute] Nominatim failed for", query, "status:", res.status);
      return null;
    }
    const results = (await res.json()) as Array<{
      lat: string;
      lon: string;
    }>;
    if (!results[0]) {
      console.error("[commute] Nominatim returned no results for", query);
      return null;
    }
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  } catch (err) {
    console.error("[commute] Nominatim error for", address, err);
    return null;
  }
}

type TfLJourney = {
  duration: number;
  legs: Array<{ instruction: { summary: string } }>;
};

async function fetchTfLJourney(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<{ minutes: number; route: string } | null> {
  const params = new URLSearchParams({
    timeIs: "departing",
  });

  if (process.env.TFL_APP_ID) params.set("app_id", process.env.TFL_APP_ID);
  if (process.env.TFL_APP_KEY) params.set("app_key", process.env.TFL_APP_KEY);

  try {
    const journey = await retryWithBackoff(
      async () => {
        const res = await fetch(
          `https://api.tfl.gov.uk/Journey/JourneyResults/${fromLat},${fromLon}/to/${toLat},${toLon}?${params}`,
        );
        if (!res.ok) throw new Error(`TfL API ${res.status}`);
        return (await res.json()) as { journeys?: TfLJourney[] };
      },
      { maxRetries: 2, baseDelayMs: 1000, tag: "tfl" },
    );

    const best = journey.journeys?.[0];
    if (!best) {
      console.error("[commute] TfL returned no journeys for", fromLat, fromLon, "->", toLat, toLon);
      return null;
    }

    const route = best.legs
      .map((l) => l.instruction.summary)
      .join(" → ");

    return { minutes: best.duration, route };
  } catch (err) {
    console.error("[commute] TfL journey fetch failed:", err);
    return null;
  }
}

function computeCommuteScore(
  minutes: number,
  maxMinutes: number,
): number {
  const ratio = minutes / maxMinutes;
  if (ratio <= 0.5) return 10;
  if (ratio <= 0.75) return 8;
  if (ratio <= 1.0) return 6;
  if (ratio <= 1.25) return 4;
  if (ratio <= 1.5) return 2;
  return 1;
}

export async function evaluateCommute(
  fromPostcode: string,
  toPostcode: string,
  maxMinutes: number,
  address?: string,
): Promise<CommuteEvalResult> {
  if (!toPostcode) {
    console.error("[commute] No commute destination postcode configured");
    return { commute_score: null, commute_minutes: null, commute_route: null };
  }

  // Resolve origin
  let origin = await resolvePostcodeToCoords(fromPostcode);
  if (!origin && address) {
    origin = await resolveAddressToCoords(address);
  }
  if (!origin) {
    console.error("[commute] Could not resolve origin postcode:", fromPostcode, "address:", address);
    return { commute_score: null, commute_minutes: null, commute_route: null };
  }

  // Resolve destination
  const dest = await resolvePostcodeToCoords(toPostcode);
  if (!dest) {
    console.error("[commute] Could not resolve destination postcode:", toPostcode);
    return { commute_score: null, commute_minutes: null, commute_route: null };
  }

  const journey = await fetchTfLJourney(
    origin.lat,
    origin.lon,
    dest.lat,
    dest.lon,
  );

  if (!journey) {
    console.error("[commute] TfL journey returned null for", fromPostcode, "->", toPostcode);
    return { commute_score: null, commute_minutes: null, commute_route: null };
  }

  return {
    commute_score: computeCommuteScore(journey.minutes, maxMinutes),
    commute_minutes: journey.minutes,
    commute_route: journey.route,
  };
}
