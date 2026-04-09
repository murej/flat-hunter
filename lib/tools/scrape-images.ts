import { retryWithBackoff, sleep } from "@/lib/utils/retry";

type Portal = "rightmove" | "zoopla" | "onthemarket" | "primelocation" | "themodernhouse" | "ostrich" | "unknown";

const PORTAL_DETECTORS: Array<{ portal: Portal; pattern: RegExp }> = [
  { portal: "rightmove", pattern: /rightmove\.co\.uk/ },
  { portal: "zoopla", pattern: /zoopla\.co\.uk/ },
  { portal: "onthemarket", pattern: /onthemarket\.com/ },
  { portal: "primelocation", pattern: /primelocation\.com/ },
  { portal: "themodernhouse", pattern: /themodernhouse\.com/ },
  { portal: "ostrich", pattern: /ostrich\.co\.uk/ },
];

function detectPortal(url: string): Portal {
  for (const { portal, pattern } of PORTAL_DETECTORS) {
    if (pattern.test(url)) return portal;
  }
  return "unknown";
}

// Portals that block server-side scraping (e.g. Cloudflare JS challenge, 403, walled garden).
const SCRAPE_BLOCKED_PORTALS: Set<Portal> = new Set(["zoopla", "themodernhouse", "ostrich"]);

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const FETCH_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_IMAGES = 10;
const MAX_DOWNLOAD = 3;

// --- Structured details extracted from the portal page ---

export type ScrapedDetails = {
  tenure: string | null;
  lease_length_years: number | null;
  property_type: string | null;
  key_features: string[];
  epc_rating: string | null;
  council_tax_band: string | null;
  /** Backfill only — not stored if the listing already has a value */
  sqft: number | null;
  /** Backfill only — not stored if the listing already has a value */
  floorplan_url: string | null;
};

export type ScrapedListing = {
  imageUrls: string[];
  details: ScrapedDetails;
};

const EMPTY_DETAILS: ScrapedDetails = {
  tenure: null,
  lease_length_years: null,
  property_type: null,
  key_features: [],
  epc_rating: null,
  council_tax_band: null,
  sqft: null,
  floorplan_url: null,
};

// --- Shared helpers ---

/** Scan a string for URLs matching any of the given hostname fragments. */
function scanForCdnUrls(text: string, hostFragments: string[]): string[] {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const matches = text.match(urlPattern) ?? [];
  return matches.filter((u) =>
    hostFragments.some((h) => u.includes(h)),
  );
}

/** Safe JSON.parse — returns null on any error. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Normalise a tenure string to "Freehold" | "Leasehold" | null. */
function normaliseTenure(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("freehold")) return "Freehold";
  if (lower.includes("leasehold")) return "Leasehold";
  return null;
}

/** Normalise an EPC letter rating to a single uppercase letter A–G, or null. */
function normaliseEpc(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const letter = String(raw).trim().charAt(0).toUpperCase();
  if (/^[A-G]$/.test(letter)) return letter;
  return null;
}

/** Normalise a council tax band letter A–H, or null. */
function normaliseCtaxBand(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const letter = String(raw).trim().charAt(0).toUpperCase();
  if (/^[A-H]$/.test(letter)) return letter;
  return null;
}

/** Extract lease length years from a string like "125 years" or "999 year lease". */
function parseLeaseYears(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const match = String(raw).match(/(\d+)/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n > 0 && n < 2000 ? n : null;
}

// --- Per-portal image extractors (unchanged from original) ---

function extractRightmoveImages(html: string): string[] {
  const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (match) {
    try {
      const json = match[1];
      const urls = scanForCdnUrls(json, ["media.rightmove.co.uk"]);
      if (urls.length > 0) return urls;
    } catch { /* fall through */ }
  }
  return scanForCdnUrls(html, ["media.rightmove.co.uk"]);
}

function extractZooplaImages(html: string): string[] {
  const match = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]+?)<\/script>/);
  if (match) {
    try {
      const json = match[1];
      const urls = scanForCdnUrls(json, ["lc.zoocdn.com", "lid.zoocdn.com", "listing-images.zoocdn.com"]);
      if (urls.length > 0) return urls;
    } catch { /* fall through */ }
  }
  return scanForCdnUrls(html, ["lc.zoocdn.com", "lid.zoocdn.com", "listing-images.zoocdn.com"]);
}

function extractOnTheMarketImages(html: string): string[] {
  return extractJsonLdAndOgImages(html, ["images.onthemarket.com"]);
}

function extractPrimeLocationImages(html: string): string[] {
  return extractJsonLdAndOgImages(html, ["images.primelocation.com"]);
}

/** Extract images from JSON-LD blocks and og:image meta tags. */
function extractJsonLdAndOgImages(html: string, cdnHosts: string[]): string[] {
  const urls: string[] = [];

  const ldPattern = /<script\s+type="application\/ld\+json">([\s\S]+?)<\/script>/g;
  let ldMatch;
  while ((ldMatch = ldPattern.exec(html)) !== null) {
    try {
      const obj = JSON.parse(ldMatch[1]);
      const images = obj.image;
      if (typeof images === "string") {
        urls.push(images);
      } else if (Array.isArray(images)) {
        for (const img of images) {
          if (typeof img === "string") urls.push(img);
          else if (img?.url) urls.push(img.url);
          else if (img?.contentUrl) urls.push(img.contentUrl);
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  }

  if (urls.length > 0) return urls;

  const cdnUrls = scanForCdnUrls(html, cdnHosts);
  if (cdnUrls.length > 0) return cdnUrls;

  return extractOgImages(html);
}

function extractOgImages(html: string): string[] {
  const urls: string[] = [];
  const pattern = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    urls.push(match[1]);
  }
  const reversed = /<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/gi;
  while ((match = reversed.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// --- Per-portal detail extractors ---

/**
 * Rightmove: parse window.__PRELOADED_STATE__ JSON.
 * Paths observed in the wild (may vary — all accesses are defensive):
 *   propertyData.keyFeatures[]
 *   propertyData.propertySubType
 *   propertyData.tenure.tenureType / yearsRemainingOnLease
 *   propertyData.councilTaxBand
 *   propertyData.epcGraphs[0].eer.currentRating  (numeric, map to letter)
 *   propertyData.sizings[].unit / value  (sqft)
 *   propertyData.floorplanImages[].url
 */
function extractRightmoveDetails(html: string): Partial<ScrapedDetails> {
  const stateMatch = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (!stateMatch) return {};

  const state = tryParseJson(stateMatch[1]) as Record<string, unknown> | null;
  if (!state) return {};

  const pd = (state.propertyData ?? {}) as Record<string, unknown>;

  // Tenure
  const tenureObj = (pd.tenure ?? {}) as Record<string, unknown>;
  const tenure = normaliseTenure(tenureObj.tenureType as string | undefined);
  const lease_length_years = tenure === "Leasehold"
    ? parseLeaseYears(tenureObj.yearsRemainingOnLease as string | number | undefined)
    : null;

  // Property type
  const property_type = typeof pd.propertySubType === "string" && pd.propertySubType
    ? capitalise(pd.propertySubType)
    : null;

  // Key features
  const rawFeatures = pd.keyFeatures;
  const key_features: string[] = Array.isArray(rawFeatures)
    ? rawFeatures.filter((f): f is string => typeof f === "string")
    : [];

  // Council tax band
  const council_tax_band = normaliseCtaxBand(pd.councilTaxBand as string | undefined);

  // EPC — numeric current rating mapped to band letter
  let epc_rating: string | null = null;
  const epcGraphs = pd.epcGraphs;
  if (Array.isArray(epcGraphs) && epcGraphs.length > 0) {
    const firstGraph = epcGraphs[0] as Record<string, unknown>;
    const eer = firstGraph?.eer as Record<string, unknown> | undefined;
    const currentRating = eer?.currentRating;
    if (currentRating != null) {
      epc_rating = epcRatingFromNumber(Number(currentRating));
    }
    // Also check for a direct letter field
    if (!epc_rating && typeof eer?.currentEnergyEfficiencyRating === "string") {
      epc_rating = normaliseEpc(eer.currentEnergyEfficiencyRating as string);
    }
  }
  // Fallback: direct letter field
  if (!epc_rating) {
    epc_rating = normaliseEpc(pd.epcRating as string | undefined);
  }

  // Sqft — Rightmove may have sizings array
  let sqft: number | null = null;
  const sizings = pd.sizings;
  if (Array.isArray(sizings)) {
    for (const s of sizings as Array<Record<string, unknown>>) {
      if (s.unit === "sqft" && typeof s.minimumSize === "number") {
        sqft = Math.round(s.minimumSize);
        break;
      }
    }
  }
  // Also check a top-level displaySize field
  if (!sqft && typeof pd.displaySize === "string") {
    const m = (pd.displaySize as string).match(/(\d[\d,]+)\s*sq\s*ft/i);
    if (m) sqft = parseInt(m[1].replace(/,/g, ""), 10);
  }

  // Floorplan — Rightmove stores them separately in floorplanImages
  let floorplan_url: string | null = null;
  const fpImages = pd.floorplanImages;
  if (Array.isArray(fpImages) && fpImages.length > 0) {
    const fp = fpImages[0] as Record<string, unknown>;
    if (typeof fp.url === "string") floorplan_url = fp.url;
  }

  return { tenure, lease_length_years, property_type, key_features, council_tax_band, epc_rating, sqft, floorplan_url };
}

/**
 * OnTheMarket / PrimeLocation: parse JSON-LD schema.org blocks + regex key-facts table.
 */
function extractJsonLdDetails(html: string): Partial<ScrapedDetails> {
  const details: Partial<ScrapedDetails> = {};

  const ldPattern = /<script\s+type="application\/ld\+json">([\s\S]+?)<\/script>/g;
  let ldMatch;
  while ((ldMatch = ldPattern.exec(html)) !== null) {
    const obj = tryParseJson(ldMatch[1]) as Record<string, unknown> | null;
    if (!obj) continue;

    // Property type from @type
    if (!details.property_type) {
      const typeVal = obj["@type"];
      if (typeof typeVal === "string" && typeVal !== "Product" && typeVal !== "Thing") {
        details.property_type = capitalise(typeVal);
      }
    }

    // floorSize → sqft
    if (!details.sqft) {
      const fs = obj.floorSize as Record<string, unknown> | undefined;
      if (fs?.unitCode === "FTK" && typeof fs.value === "number") {
        details.sqft = Math.round(fs.value as number);
      }
    }

    // description often contains key facts but too unstructured to parse here
  }

  // Regex key-facts scan (works for both OTM and PrimeLocation HTML tables)
  mergePartial(details, extractKeyFactsFromHtml(html));

  return details;
}

/**
 * Generic regex-based extractor for UK portal key-facts sections.
 * Looks for labelled rows like "Tenure | Leasehold" in HTML tables/dls.
 */
function extractKeyFactsFromHtml(html: string): Partial<ScrapedDetails> {
  const details: Partial<ScrapedDetails> = {};

  // Strip tags from a snippet to get plain text
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Tenure
  const tenureMatch = html.match(/tenure[^<]{0,30}?(?:<[^>]+>\s*)*([^<]{4,60})/i);
  if (tenureMatch) {
    const raw = stripTags(tenureMatch[1]);
    const t = normaliseTenure(raw);
    if (t && !details.tenure) details.tenure = t;
    if (t === "Leasehold" && !details.lease_length_years) {
      details.lease_length_years = parseLeaseYears(raw);
    }
  }

  // Lease length when not already captured
  if (!details.lease_length_years) {
    const leaseMatch = html.match(/(?:lease(?:\s+length)?|years\s+remaining)[^<]{0,30}?(?:<[^>]+>\s*)*(\d+\s*years?)/i);
    if (leaseMatch) {
      details.lease_length_years = parseLeaseYears(leaseMatch[1]);
    }
  }

  // EPC
  const epcMatch = html.match(/epc[^<]{0,40}?(?:rating|band)?[^<]{0,10}?(?:<[^>]+>\s*)*([A-G])\b/i);
  if (epcMatch && !details.epc_rating) {
    details.epc_rating = normaliseEpc(epcMatch[1]);
  }

  // Council tax band
  const ctaxMatch = html.match(/council\s+tax[^<]{0,30}?(?:<[^>]+>\s*)*Band\s*([A-H])\b/i);
  if (ctaxMatch && !details.council_tax_band) {
    details.council_tax_band = normaliseCtaxBand(ctaxMatch[1]);
  }

  // Property type from meta og:type or page title patterns
  const typeMatch = html.match(/<meta[^>]+property="og:type"[^>]+content="([^"]+)"/i)
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:type"/i);
  if (typeMatch && !details.property_type) {
    const t = typeMatch[1];
    if (t !== "website" && t !== "article") details.property_type = capitalise(t);
  }

  return details;
}

// --- EPC numeric → letter mapping (UK SAP rating scale) ---

function epcRatingFromNumber(rating: number): string | null {
  if (!Number.isFinite(rating)) return null;
  if (rating >= 92) return "A";
  if (rating >= 81) return "B";
  if (rating >= 69) return "C";
  if (rating >= 55) return "D";
  if (rating >= 39) return "E";
  if (rating >= 21) return "F";
  if (rating >= 1)  return "G";
  return null;
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function mergePartial<T extends object>(target: Partial<T>, source: Partial<T>): void {
  for (const key of Object.keys(source) as Array<keyof T>) {
    const val = source[key];
    if (val == null) continue;
    if (Array.isArray(val) && (val as unknown[]).length === 0) continue;
    if (target[key] == null || (Array.isArray(target[key]) && (target[key] as unknown[]).length === 0)) {
      target[key] = val;
    }
  }
}

// --- Throttle ---

let _portalQueue: Promise<void> = Promise.resolve();

function portalThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const p = _portalQueue.then(() => sleep(500)).then(fn);
  _portalQueue = p.then(
    () => {},
    () => {},
  );
  return p;
}

// --- Main exports ---

/**
 * Fetch the listing page once and extract both images and structured details.
 * Returns empty arrays/nulls for blocked portals or on fetch failure.
 */
export async function scrapeListingPage(url: string): Promise<ScrapedListing> {
  const portal = detectPortal(url);
  if (SCRAPE_BLOCKED_PORTALS.has(portal)) {
    return { imageUrls: [], details: { ...EMPTY_DETAILS } };
  }

  let html: string;
  try {
    html = await portalThrottle(() =>
      retryWithBackoff(
        async () => {
          const res = await fetch(url, {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            redirect: "follow",
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching ${url}`);
          }
          return res.text();
        },
        { maxRetries: 1, baseDelayMs: 2000, tag: "scrape-listing" },
      ),
    );
  } catch {
    return { imageUrls: [], details: { ...EMPTY_DETAILS } };
  }

  // Extract images
  let rawImageUrls: string[];
  switch (portal) {
    case "rightmove":
      rawImageUrls = extractRightmoveImages(html);
      break;
    case "zoopla":
      rawImageUrls = extractZooplaImages(html);
      break;
    case "onthemarket":
      rawImageUrls = extractOnTheMarketImages(html);
      break;
    case "primelocation":
      rawImageUrls = extractPrimeLocationImages(html);
      break;
    default:
      rawImageUrls = extractOgImages(html);
  }
  const imageUrls = [...new Set(rawImageUrls)].slice(0, MAX_IMAGES);

  // Extract details
  let rawDetails: Partial<ScrapedDetails> = {};
  try {
    switch (portal) {
      case "rightmove":
        rawDetails = extractRightmoveDetails(html);
        break;
      case "onthemarket":
      case "primelocation":
        rawDetails = extractJsonLdDetails(html);
        break;
      default:
        // Generic regex fallback for unknown portals
        rawDetails = extractKeyFactsFromHtml(html);
    }
  } catch {
    // Never let detail extraction crash the pipeline
  }

  const details: ScrapedDetails = {
    tenure: rawDetails.tenure ?? null,
    lease_length_years: rawDetails.lease_length_years ?? null,
    property_type: rawDetails.property_type ?? null,
    key_features: rawDetails.key_features ?? [],
    epc_rating: rawDetails.epc_rating ?? null,
    council_tax_band: rawDetails.council_tax_band ?? null,
    sqft: rawDetails.sqft ?? null,
    floorplan_url: rawDetails.floorplan_url ?? null,
  };

  return { imageUrls, details };
}

/**
 * Download image URLs with proper headers (Referer, User-Agent).
 * Returns successfully downloaded images as Uint8Array[].
 * Skips failures silently — caller gets whatever succeeded.
 */
export async function downloadImages(
  imageUrls: string[],
  referer: string,
): Promise<Uint8Array[]> {
  const toDownload = imageUrls.slice(0, MAX_DOWNLOAD);
  const results = await Promise.allSettled(
    toDownload.map(async (url) => {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: referer,
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} downloading ${url}`);
      }
      const data = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "unknown";
      return { data, contentType };
    }),
  );

  const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const images: Uint8Array[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      const mimeBase = r.value.contentType.split(";")[0].trim();
      if (SUPPORTED_IMAGE_TYPES.has(mimeBase)) {
        images.push(r.value.data);
      }
    }
  }
  return images;
}
