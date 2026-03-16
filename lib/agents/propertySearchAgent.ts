import Anthropic from "@anthropic-ai/sdk";
import { PROPERTY_SEARCH_SYSTEM, EMAIL_PARSER_SYSTEM } from "@/lib/prompts";
import { deduplicateAndStore } from "./ingest";
import { runEvaluationPipeline } from "./propertyEvaluator";
import type { Preferences } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  searched: number;
  newCount: number;
  newListingIds: string[];
  sentCount: number;
  suppressedCount: number;
}

interface RawListing {
  portal_id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  description: string;
  image_urls: string[];
  floorplan_url: string;
  agent_name: string;
  agent_email: string;
  listed_date: string;
}

// ─── Recency filter ───────────────────────────────────────────────────────────

const MAX_AGE_HOURS = 72;

function isRecentListing(listedDate: string): boolean {
  if (!listedDate) return true; // keep if date unknown
  const listed = new Date(listedDate);
  if (isNaN(listed.getTime())) return true; // keep if unparseable

  const now = new Date();

  // Month-only dates (e.g. "March 2026", "2026-03") resolve to the 1st. If the
  // month and year match today and the string contains no day number, treat the
  // listing as current rather than discarding it as 15+ days old.
  const noDay = !/\b(0?[1-9]|[12]\d|3[01])\b/.test(listedDate);
  if (
    noDay &&
    listed.getDate() === 1 &&
    listed.getMonth() === now.getMonth() &&
    listed.getFullYear() === now.getFullYear()
  ) {
    return true;
  }

  const ageHours = (Date.now() - listed.getTime()) / (1000 * 60 * 60);
  return ageHours <= MAX_AGE_HOURS;
}

function filterRecentListings(listings: RawListing[]): RawListing[] {
  const filtered = listings.filter((l) => isRecentListing(l.listed_date));
  const dropped = listings.length - filtered.length;
  if (dropped > 0) {
    console.log(`Dropped ${dropped} listing(s) older than ${MAX_AGE_HOURS}h`);
  }
  return filtered;
}

// ─── Firecrawl helpers (Rightmove + Zoopla) ───────────────────────────────────

async function scrapeViaFirecrawl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return "";

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });

  if (!res.ok) {
    console.warn(`Firecrawl returned ${res.status} for ${url}`);
    return "";
  }

  const data = await res.json();
  return data?.data?.markdown ?? "";
}

async function parseMarkdownListings(
  markdown: string,
  source: string
): Promise<RawListing[]> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: EMAIL_PARSER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extract all property listings from this ${source} search results page content:\n\n${markdown}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]) as RawListing[];
  } catch {
    console.error(`Failed to parse ${source} listings JSON`);
    return [];
  }
}

async function fetchRightmoveViaFirecrawl(
  area: string,
  preferences: Preferences
): Promise<RawListing[]> {
  const propertyType = preferences.style_notes?.toLowerCase().includes("house")
    ? "houses"
    : "flats";
  const params = new URLSearchParams({
    searchType: "SALE",
    minBedrooms: String(preferences.min_bedrooms ?? 1),
    maxPrice: String(preferences.max_price ?? 999999999),
    propertyTypes:
      propertyType === "houses" ? "detached,semi-detached,terraced" : "flat",
    maxDaysSinceAdded: "3",
  });
  const rmUrl = `https://www.rightmove.co.uk/property-for-sale/search.html?searchLocation=${encodeURIComponent(area)}&useLocationIdentifier=false&locationIdentifier=&${params.toString()}`;

  const markdown = await scrapeViaFirecrawl(rmUrl);
  if (!markdown) return [];

  const listings = filterRecentListings(
    await parseMarkdownListings(markdown, "Rightmove")
  );
  if (listings.length > 0) {
    console.log(`Rightmove ${area} (Firecrawl): ${listings.length} listings`);
  }
  return listings;
}

async function fetchZooplaViaFirecrawl(
  area: string,
  preferences: Preferences
): Promise<RawListing[]> {
  const areaSlug = area
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const params = new URLSearchParams({
    price_max: String(preferences.max_price ?? 999999999),
    beds_min: String(preferences.min_bedrooms ?? 1),
    page_size: "25",
    added_to_site: "3days",
  });
  const zooplaUrl = `https://www.zoopla.co.uk/for-sale/flats/${areaSlug}/?${params.toString()}`;

  const markdown = await scrapeViaFirecrawl(zooplaUrl);
  if (!markdown) return [];

  const listings = filterRecentListings(
    await parseMarkdownListings(markdown, "Zoopla")
  );
  if (listings.length > 0) {
    console.log(`Zoopla ${area} (Firecrawl): ${listings.length} listings`);
  }
  return listings;
}

// ─── Fallback: Claude web_search ─────────────────────────────────────────────

async function searchViaWebSearch(
  area: string,
  preferences: Preferences
): Promise<RawListing[]> {
  const propertyType = preferences.style_notes?.toLowerCase().includes("house")
    ? "house"
    : "flat";

  const prompt = [
    `Search for ${propertyType} listings matching these buyer preferences:`,
    `Target area: ${area}`,
    `Max price: £${preferences.max_price?.toLocaleString()}`,
    `Min bedrooms: ${preferences.min_bedrooms}`,
    preferences.must_haves?.length
      ? `Must-haves: ${preferences.must_haves.join(", ")}`
      : null,
    ``,
    `Search Rightmove and Zoopla for this area. Return all matching listings as a JSON array.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: PROPERTY_SEARCH_SYSTEM,
    tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.filter((b) => b.type === "text").pop();
  const text = textBlock?.type === "text" ? textBlock.text : "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return filterRecentListings(JSON.parse(jsonMatch[0]) as RawListing[]);
  } catch {
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function propertySearchAgent(
  preferences: Preferences
): Promise<SearchResult> {
  if (!preferences.areas || preferences.areas.length === 0) {
    return { searched: 0, newCount: 0, newListingIds: [], sentCount: 0, suppressedCount: 0 };
  }

  const hasFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY);

  const perAreaResults = await Promise.all(
    preferences.areas.map(async (area) => {
      const listings: RawListing[] = [];

      if (hasFirecrawl) {
        // Firecrawl: Rightmove + Zoopla in parallel
        const [rmListings, zListings] = await Promise.all([
          fetchRightmoveViaFirecrawl(area, preferences).catch((e) => {
            console.error(`Rightmove Firecrawl failed for ${area}:`, e);
            return [] as RawListing[];
          }),
          fetchZooplaViaFirecrawl(area, preferences).catch((e) => {
            console.error(`Zoopla Firecrawl failed for ${area}:`, e);
            return [] as RawListing[];
          }),
        ]);
        listings.push(...rmListings, ...zListings);
      }

      // Web search fallback: always runs if Firecrawl found nothing (or not configured)
      if (listings.length === 0) {
        console.log(`${area}: using web_search fallback`);
        const fbListings = await searchViaWebSearch(area, preferences).catch(
          (e) => {
            console.error(`web_search failed for ${area}:`, e);
            return [] as RawListing[];
          }
        );
        listings.push(...fbListings);
      }

      return listings;
    })
  );

  const allListings = perAreaResults.flat();
  const newListingIds = await deduplicateAndStore(
    allListings as Parameters<typeof deduplicateAndStore>[0]
  );

  const evalResults = await Promise.all(
    newListingIds.map((id) =>
      runEvaluationPipeline(id).catch((e) => {
        console.error(`Evaluation failed for ${id}:`, e);
        return false;
      })
    )
  );

  const sentCount = evalResults.filter(Boolean).length;
  const suppressedCount = evalResults.length - sentCount;

  return {
    searched: preferences.areas.length,
    newCount: newListingIds.length,
    newListingIds,
    sentCount,
    suppressedCount,
  };
}
