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

// --- Per-portal extractors ---

/** Scan a JSON string for URLs matching any of the given hostname fragments. */
function scanForCdnUrls(json: string, hostFragments: string[]): string[] {
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  const matches = json.match(urlPattern) ?? [];
  return matches.filter((u) =>
    hostFragments.some((h) => u.includes(h)),
  );
}

function extractRightmoveImages(html: string): string[] {
  const match = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (match) {
    try {
      const json = match[1];
      const urls = scanForCdnUrls(json, ["media.rightmove.co.uk"]);
      if (urls.length > 0) return urls;
    } catch { /* fall through */ }
  }
  // Broader fallback: scan entire HTML for Rightmove CDN URLs
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

  // JSON-LD blocks
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

  // CDN scan fallback
  const cdnUrls = scanForCdnUrls(html, cdnHosts);
  if (cdnUrls.length > 0) return cdnUrls;

  // og:image fallback
  return extractOgImages(html);
}

function extractOgImages(html: string): string[] {
  const urls: string[] = [];
  const pattern = /<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    urls.push(match[1]);
  }
  // Also match reversed attribute order
  const reversed = /<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/gi;
  while ((match = reversed.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return urls;
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

// --- Main export ---

export async function scrapeListingImages(url: string): Promise<string[]> {
  const portal = detectPortal(url);
  if (SCRAPE_BLOCKED_PORTALS.has(portal)) return [];

  const html = await portalThrottle(() =>
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
      { maxRetries: 1, baseDelayMs: 2000, tag: "scrape-images" },
    ),
  );

  let urls: string[];
  switch (portal) {
    case "rightmove":
      urls = extractRightmoveImages(html);
      break;
    case "zoopla":
      urls = extractZooplaImages(html);
      break;
    case "onthemarket":
      urls = extractOnTheMarketImages(html);
      break;
    case "primelocation":
      urls = extractPrimeLocationImages(html);
      break;
    default:
      urls = extractOgImages(html);
  }

  // Dedupe and cap
  return [...new Set(urls)].slice(0, MAX_IMAGES);
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
