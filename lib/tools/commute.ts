import type { CommuteEvalResult } from "@/types";
import { retryWithBackoff, nominatimThrottle } from "@/lib/utils/retry";
import { getSupabaseAdmin } from "@/lib/supabase";

const COMMUTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const API_TIMEOUT = 8000;

async function resolvePostcodeToCoords(
  postcode: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    // Try full postcode first
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      { signal: AbortSignal.timeout(API_TIMEOUT) },
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
      { signal: AbortSignal.timeout(API_TIMEOUT) },
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
  return nominatimThrottle(async () => {
    try {
      const simplified = simplifyAddress(address);
      const query = simplified !== address ? simplified : address;

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { "User-Agent": "Stath/1.0" }, signal: AbortSignal.timeout(API_TIMEOUT) },
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
  });
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
          { signal: AbortSignal.timeout(API_TIMEOUT) },
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
  return Math.max(1, Math.round(10 - 9 * (ratio / 1.5)));
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

  // Check cache
  const cacheKey = `${fromPostcode.trim().toUpperCase()}:${toPostcode.trim().toUpperCase()}`;
  const { data: cached } = await getSupabaseAdmin()
    .from("agent_context")
    .select("content, expires_at")
    .eq("agent_id", "commute")
    .eq("scope", "postcode_pair")
    .eq("scope_value", cacheKey)
    .single();

  if (cached && cached.content && (!cached.expires_at || new Date(cached.expires_at) > new Date())) {
    const c = cached.content as { commute_score: number; commute_minutes: number; commute_route: string };
    if (c.commute_minutes != null) {
      return {
        commute_score: computeCommuteScore(c.commute_minutes, maxMinutes),
        commute_minutes: c.commute_minutes,
        commute_route: c.commute_route,
      };
    }
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

  // Store in cache (score is excluded — recomputed from minutes so maxMinutes changes are reflected)
  await getSupabaseAdmin().from("agent_context").upsert(
    {
      agent_id: "commute",
      scope: "postcode_pair",
      scope_value: cacheKey,
      content: { commute_minutes: journey.minutes, commute_route: journey.route },
      expires_at: new Date(Date.now() + COMMUTE_CACHE_TTL_MS).toISOString(),
    },
    { onConflict: "agent_id,scope,scope_value" },
  );

  return {
    commute_score: computeCommuteScore(journey.minutes, maxMinutes),
    commute_minutes: journey.minutes,
    commute_route: journey.route,
  };
}
