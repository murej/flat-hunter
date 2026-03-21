import { retryWithBackoff, sleep } from "@/lib/utils/retry";

type PostcodeResult = {
  postcode: string;
  latitude: number;
  longitude: number;
  admin_ward: string;
  parish: string;
  lsoa: string;
  msoa: string;
  region: string;
  parliamentary_constituency: string;
};

type AreaContext = {
  postcode: PostcodeResult;
  crime: unknown[];
  imd: unknown | null;
  matchedArea: string | null;
};

async function fetchPostcode(postcode: string): Promise<PostcodeResult | null> {
  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { result: PostcodeResult };
  return json.result;
}

async function fetchCrime(
  lat: number,
  lng: number,
): Promise<unknown[]> {
  try {
    const crimes = await retryWithBackoff(
      async () => {
        const res = await fetch(
          `https://data.police.uk/api/crimes-street/all-crime?lat=${lat}&lng=${lng}`,
        );
        if (!res.ok) throw new Error(`Police API ${res.status}`);
        return (await res.json()) as unknown[];
      },
      { maxRetries: 2, baseDelayMs: 2000, tag: "police-api" },
    );
    return crimes;
  } catch {
    return [];
  }
}

async function fetchIMD(lsoa: string): Promise<unknown | null> {
  try {
    const url = `https://services3.arcgis.com/ivmBBrHfQfDnDf8Q/arcgis/rest/services/Indices_of_Multiple_Deprivation_(IMD)_2019/FeatureServer/0/query?where=lsoa11cd='${encodeURIComponent(lsoa)}'&outFields=*&f=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: Array<{ attributes: unknown }>;
    };
    return json.features?.[0]?.attributes ?? null;
  } catch {
    return null;
  }
}

function fuzzyAreaMatch(
  postcodeResult: PostcodeResult,
  targetAreas: string[],
): string | null {
  const fields = [
    postcodeResult.admin_ward,
    postcodeResult.parish,
    postcodeResult.msoa,
    postcodeResult.parliamentary_constituency,
  ];

  for (const area of targetAreas) {
    const lower = area.toLowerCase();
    for (const field of fields) {
      if (field && field.toLowerCase().includes(lower)) return area;
    }
  }
  return null;
}

export async function fetchAreaContext(
  postcode: string,
  targetAreas: string[],
  _address?: string,
): Promise<AreaContext | null> {
  const postcodeResult = await fetchPostcode(postcode);
  if (!postcodeResult) return null;

  const [crime, imd] = await Promise.all([
    fetchCrime(postcodeResult.latitude, postcodeResult.longitude),
    fetchIMD(postcodeResult.lsoa),
  ]);

  return {
    postcode: postcodeResult,
    crime,
    imd,
    matchedArea: fuzzyAreaMatch(postcodeResult, targetAreas),
  };
}

export async function resolveAreaToPostcode(
  area: string,
): Promise<string | null> {
  // Use Nominatim to find a representative postcode for an area
  await sleep(1100); // Nominatim rate limit: 1 req/sec
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(area + ", London, UK")}&format=json&limit=1&addressdetails=1`,
      { headers: { "User-Agent": "Stath/1.0" } },
    );
    if (!res.ok) return null;
    const results = (await res.json()) as Array<{
      address?: { postcode?: string };
    }>;
    return results[0]?.address?.postcode ?? null;
  } catch {
    return null;
  }
}

export async function getPostcodeContextForArea(
  area: string,
): Promise<AreaContext | null> {
  const postcode = await resolveAreaToPostcode(area);
  if (!postcode) return null;
  return fetchAreaContext(postcode, [area]);
}
