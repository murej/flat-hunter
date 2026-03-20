import type { CommuteEvalResult } from "@/types";
import { retryWithBackoff, sleep } from "@/lib/utils/retry";

async function resolvePostcodeToCoords(
  postcode: string,
): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    result: { latitude: number; longitude: number };
  };
  return { lat: json.result.latitude, lon: json.result.longitude };
}

async function resolveAddressToCoords(
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  await sleep(1100); // Nominatim rate limit
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "User-Agent": "Stath/1.0" } },
    );
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{
      lat: string;
      lon: string;
    }>;
    if (!results[0]) return null;
    return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
  } catch {
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
    from: `${fromLat},${fromLon}`,
    to: `${toLat},${toLon}`,
    mode: "public-transport",
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
    if (!best) return null;

    const route = best.legs
      .map((l) => l.instruction.summary)
      .join(" → ");

    return { minutes: best.duration, route };
  } catch {
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
  // Resolve origin
  let origin = await resolvePostcodeToCoords(fromPostcode);
  if (!origin && address) {
    origin = await resolveAddressToCoords(address);
  }
  if (!origin) {
    return { commute_score: 5, commute_minutes: null, commute_route: null };
  }

  // Resolve destination
  const dest = await resolvePostcodeToCoords(toPostcode);
  if (!dest) {
    return { commute_score: 5, commute_minutes: null, commute_route: null };
  }

  const journey = await fetchTfLJourney(
    origin.lat,
    origin.lon,
    dest.lat,
    dest.lon,
  );

  if (!journey) {
    return { commute_score: 5, commute_minutes: null, commute_route: null };
  }

  return {
    commute_score: computeCommuteScore(journey.minutes, maxMinutes),
    commute_minutes: journey.minutes,
    commute_route: journey.route,
  };
}
