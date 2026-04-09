import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { MAX_INPUT_CHARS } from "./config";

/** Max image URLs per listing (email extract + DB fallback). */
export const MAX_IMAGE_CANDIDATES = 8;

/** Skip <img> URLs when both HTML width/height parse and area is below this (strip email thumbnails). */
const MIN_PARSED_IMG_AREA = 140 * 140;

const RESERVE_SUFFIX_CHARS = 6000;

/** Max graph distance (img node to matching anchor) for Tier 1 association. */
const MAX_DOM_DISTANCE = 64;

const TRACKING_QUERY_KEYS = /^utm_|^fbclid$|^gclid$|^mc_eid$|^_ga$/i;

/** Heuristic: JSON or mangled HTML still in quoted-printable form. */
export function looksQuotedPrintable(s: string): boolean {
  return /=(?:\r?\n|[0-9A-F]{2})/i.test(s) && (/=3D/i.test(s) || /=\r?\n/.test(s));
}

/**
 * Decode quoted-printable (RFC 2045 subset): soft line breaks and =HH bytes.
 */
export function decodeQuotedPrintable(input: string): string {
  let t = input.replace(/=\r\n/g, "").replace(/=\n/g, "");
  t = t.replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return t;
}

export function decodeQuotedPrintableIfNeeded(s: string): string {
  if (!s || !looksQuotedPrintable(s)) return s;
  return decodeQuotedPrintable(s);
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    )
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Returns absolute http(s) URL or null (skips relative, data:, cid:, dangerous schemes).
 */
export function normalizeAbsoluteHttpUrl(raw: string): string | null {
  const t = decodeBasicHtmlEntities(raw.trim());
  if (!t || /^javascript:/i.test(t) || /^vbscript:/i.test(t)) return null;
  if (t.startsWith("//")) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Strip www, tracking query params, trailing slash on path — for equality / prefix checks. */
export function normalizePropertyUrlForMatch(url: string): string | null {
  const abs = normalizeAbsoluteHttpUrl(url);
  if (!abs) return null;
  try {
    const u = new URL(abs);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const params = new URLSearchParams(u.search);
    for (const k of [...params.keys()]) {
      if (TRACKING_QUERY_KEYS.test(k)) params.delete(k);
    }
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const qs = params.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return null;
  }
}

function hostAndPath(norm: string): { host: string; path: string; rest: string } {
  const q = norm.indexOf("?");
  const base = q >= 0 ? norm.slice(0, q) : norm;
  const rest = q >= 0 ? norm.slice(q) : "";
  const slash = base.indexOf("/");
  if (slash < 0) return { host: base, path: "/", rest };
  return { host: base.slice(0, slash), path: base.slice(slash) || "/", rest };
}

/** Same registrable host + path is equal or one is a strict path prefix of the other. */
export function pathsMatchSameListing(normHref: string, normListing: string): boolean {
  if (normHref === normListing) return true;
  const a = hostAndPath(normHref);
  const b = hostAndPath(normListing);
  if (a.host !== b.host) return false;
  const pa = a.path + a.rest;
  const pb = b.path + b.rest;
  if (pa === pb) return true;
  if (pa.startsWith(pb + "/") || pa.startsWith(pb + "?")) return true;
  if (pb.startsWith(pa + "/") || pb.startsWith(pa + "?")) return true;
  return false;
}

function expandRedirectHrefOnce(hrefRaw: string): string | null {
  const abs = normalizeAbsoluteHttpUrl(hrefRaw);
  if (!abs) return null;
  try {
    const parsed = new URL(abs);
    const inner =
      parsed.searchParams.get("url") ||
      parsed.searchParams.get("u") ||
      parsed.searchParams.get("target");
    if (inner && /^https?:\/\//i.test(inner)) {
      try {
        return decodeURIComponent(inner.trim());
      } catch {
        return inner.trim();
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function hrefMatchesListing(hrefRaw: string, listingUrlRaw: string): boolean {
  const listingNorm = normalizePropertyUrlForMatch(listingUrlRaw);
  if (!listingNorm) return false;

  const tryHref = (h: string) => {
    const hn = normalizePropertyUrlForMatch(h);
    if (!hn) return false;
    return pathsMatchSameListing(hn, listingNorm);
  };

  if (tryHref(hrefRaw)) return true;
  const expanded = expandRedirectHrefOnce(hrefRaw);
  if (expanded && tryHref(expanded)) return true;
  return false;
}

function distanceViaLCA(a: HTMLElement, b: HTMLElement): number {
  const depthFromA = new Map<HTMLElement, number>();
  let da = 0;
  for (let n: HTMLElement | null = a; n; n = n.parentNode as HTMLElement | null) {
    depthFromA.set(n, da);
    da++;
  }
  let db = 0;
  for (let n: HTMLElement | null = b; n; n = n.parentNode as HTMLElement | null) {
    if (depthFromA.has(n)) return depthFromA.get(n)! + db;
    db++;
  }
  return Infinity;
}

function minDistanceToAnyAnchor(
  el: HTMLElement,
  anchors: HTMLElement[],
): number {
  if (anchors.length === 0) return Infinity;
  let m = Infinity;
  for (const a of anchors) {
    m = Math.min(m, distanceViaLCA(el, a));
  }
  return m;
}

/** Parse srcset into candidate URLs (first token of each comma-separated entry). */
export function extractSrcsetUrls(srcset: string | undefined): string[] {
  if (!srcset?.trim()) return [];
  const out: string[] = [];
  for (const part of srcset.split(",")) {
    const url = part.trim().split(/\s+/)[0];
    if (url) out.push(url);
  }
  return out;
}

const STYLE_URL_RE = /url\(\s*["']?(https?:\/\/[^"'\\)]+)["']?\s*\)/gi;

export function extractUrlsFromStyle(style: string | undefined): string[] {
  if (!style) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STYLE_URL_RE.lastIndex = 0;
  while ((m = STYLE_URL_RE.exec(style)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function parseDim(attr: string | undefined): number | null {
  if (attr == null || attr === "") return null;
  const n = Number.parseInt(String(attr).replace(/px$/i, "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function styleHasDisplayNone(style: string | undefined): boolean {
  if (!style) return false;
  return /display\s*:\s*none/i.test(style);
}

/**
 * Email template / branding assets often sit next to listing links in DOM (Tier 1 false positives).
 * Patterns observed in production Zoopla alerts (see DB image_urls on zoopla-* listings).
 */
function isEmailLayoutOrBrandingAsset(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    let pathDec = u.pathname;
    try {
      pathDec = decodeURIComponent(u.pathname);
    } catch {
      pathDec = u.pathname;
    }
    const p = pathDec.toLowerCase();

    if (
      host.includes("st.zoocdn.com") &&
      (p.includes("static_agent_logo") || p.includes("zoopla_static"))
    ) {
      return true;
    }

    if (host.includes("cloudfront.net")) {
      if (p.includes("/integrators/") || p.includes("/public/users/integrators/"))
        return true;
      if (/iconright|iconleft/i.test(p)) return true;
    }

    // ZPG / Zoopla marketing: logo pixels and short-link hosts (seen on zoopla-* listing image_urls).
    if (host.includes("advantage.zpg.co.uk")) return true;
    if (p.includes("zoopla_logo") || p.includes("zpg_logo")) return true;

    // Partner impression / ad image hosts (path often /imp/...).
    if (host.includes("asrvkeez.com")) return true;

    return false;
  } catch {
    return false;
  }
}

/** Host/path patterns for ESP beacons and click trackers (generic, not portal-specific). */
function isNoiseImageUrl(
  url: string,
  opts: {
    width: number | null;
    height: number | null;
    displayNone: boolean;
  },
): boolean {
  let host = "";
  let pathname = "";
  let search = "";
  try {
    const u = new URL(url);
    if (isEmailLayoutOrBrandingAsset(u.href)) return true;
    host = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
    search = u.search.toLowerCase();
  } catch {
    return true;
  }

  const blockedHostFragments = [
    "list-manage.com",
    "list-manage.",
    "mailchimp",
    "klclick.com",
    "mandrillapp.com",
    "sendgrid.net",
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "facebook.com",
    "mimecast.com",
    "hubspot.com",
    "hsforms.com",
    "ct.sendgrid.net",
  ];
  if (blockedHostFragments.some((f) => host.includes(f))) return true;

  if (
    pathname.includes("open.php") &&
    (search.includes("u=") || search.includes("id=") || search.includes("e="))
  ) {
    return true;
  }

  const w = opts.width;
  const h = opts.height;
  if (w === 1 && h === 1) return true;

  if (
    opts.displayNone &&
    (w == null || w <= 2) &&
    (h == null || h <= 2)
  ) {
    return true;
  }

  return false;
}

/** Remove ESP/tracker/branding URLs from persisted `listings.image_urls` (no DOM context). */
export function filterPersistedListingImageUrls(urls: string[]): string[] {
  return urls.filter(
    (u) =>
      !isNoiseImageUrl(u, { width: null, height: null, displayNone: false }),
  );
}

function imagePriorityScore(width: number | null, height: number | null): number {
  if (width != null && height != null && width > 0 && height > 0) {
    return width * height;
  }
  return 0;
}

/** Parsed <img> dimensions imply a thumbnail grid cell — drop unless we lack attrs. */
function isParsedThumbTooSmall(
  width: number | null,
  height: number | null,
): boolean {
  if (width == null || height == null) return false;
  if (width <= 0 || height <= 0) return false;
  return width * height < MIN_PARSED_IMG_AREA;
}

/**
 * Tier 2: numeric keys must appear as a path/query segment, not a random substring of a hash.
 * Slugs: require delimiter-bounded or /slug/ occurrence.
 */
export function imageUrlContainsBoundListingKey(
  imageUrl: string,
  key: string,
): boolean {
  const u = imageUrl.toLowerCase();
  const k = key.toLowerCase();
  if (!k) return false;
  if (/^\d+$/.test(key)) {
    return (
      u.includes(`/${k}/`) ||
      u.includes(`/${k}?`) ||
      u.endsWith(`/${k}`) ||
      new RegExp(`[?&=/]${k}([/?#&=]|$)`).test(u)
    );
  }
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    u.includes(`/${k}/`) ||
    new RegExp(`[/?#&=_-]${esc}(/|[?#&=_-]|$)`, "i").test(u)
  );
}

/** Same photo at multiple /{w}/{h}/file.ext sizes — keep one URL per host+filename (largest WxH in path). */
function applyWxHFilenameDedupe(bucket: Map<string, number>): void {
  const winners = new Map<
    string,
    { url: string; score: number; area: number }
  >();
  for (const [url, score] of bucket) {
    try {
      const parsed = new URL(url);
      const m = parsed.pathname.match(/^\/(\d+)\/(\d+)\/([^/]+)$/i);
      if (!m) continue;
      const area = parseInt(m[1], 10) * parseInt(m[2], 10);
      const key = `${parsed.hostname.toLowerCase()}\0${m[3].toLowerCase()}`;
      const cur = winners.get(key);
      if (!cur || area > cur.area || (area === cur.area && score > cur.score)) {
        winners.set(key, { url, score, area });
      }
    } catch {
      /* skip */
    }
  }
  const drop = new Set<string>();
  for (const [url] of bucket) {
    try {
      const parsed = new URL(url);
      const m = parsed.pathname.match(/^\/(\d+)\/(\d+)\/([^/]+)$/i);
      if (!m) continue;
      const key = `${parsed.hostname.toLowerCase()}\0${m[3].toLowerCase()}`;
      const w = winners.get(key);
      if (w && w.url !== url) drop.add(url);
    } catch {
      /* skip */
    }
  }
  for (const url of drop) bucket.delete(url);
}

type ScoredUrl = { url: string; score: number };

function bucketToSortedLimited(bucket: Map<string, number>): string[] {
  applyWxHFilenameDedupe(bucket);
  const scored: ScoredUrl[] = [...bucket.entries()].map(([url, score]) => ({
    url,
    score,
  }));
  scored.sort((a, b) => b.score - a.score);
  const ordered = scored.map((s) => s.url);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const u of ordered) {
    if (seen.has(u)) continue;
    seen.add(u);
    deduped.push(u);
    if (deduped.length >= MAX_IMAGE_CANDIDATES) break;
  }
  return deduped;
}

/** Longest numeric path segment (min 5 digits) or last substantial path slug. */
export function extractListingKeyToken(listingUrl: string): string | null {
  const abs = normalizeAbsoluteHttpUrl(listingUrl);
  if (!abs) return null;
  try {
    const path = new URL(abs).pathname;
    const nums = path.match(/\d{5,}/g);
    if (nums?.length) {
      return nums.reduce((a, b) => (a.length >= b.length ? a : b));
    }
    const segments = path.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (seg.length >= 5 && /^[a-z0-9-]+$/i.test(seg)) return seg;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function collectMatchingAnchors(
  root: HTMLElement,
  listingUrl: string,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href?.trim()) continue;
    if (hrefMatchesListing(href, listingUrl)) out.push(a as HTMLElement);
  }
  return out;
}

/** Distinct normalized portal property-detail URLs from <a href>. */
function countDistinctPropertyListingUrls(root: HTMLElement): number {
  return collectDistinctPropertyListingUrls(root).size;
}

function collectDistinctPropertyListingUrls(root: HTMLElement): Set<string> {
  const set = new Set<string>();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href?.trim()) continue;
    const abs = normalizeAbsoluteHttpUrl(href);
    if (!abs || !isPortalListingHref(abs)) continue;
    const norm = normalizePropertyUrlForMatch(abs);
    if (norm) set.add(norm);
  }
  return set;
}

function singletonPropertyListingUrl(root: HTMLElement): string | null {
  const set = collectDistinctPropertyListingUrls(root);
  if (set.size !== 1) return null;
  const norm = [...set][0];
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    const abs = normalizeAbsoluteHttpUrl(href);
    if (!abs) continue;
    const n = normalizePropertyUrlForMatch(abs);
    if (n === norm) return abs;
  }
  return null;
}

function walkGlobalImagesIntoBucket(root: HTMLElement, bucket: Map<string, number>) {
  for (const el of root.querySelectorAll("img")) {
    const w = parseDim(el.getAttribute("width"));
    const h = parseDim(el.getAttribute("height"));
    const style = el.getAttribute("style") ?? undefined;
    const displayNone = styleHasDisplayNone(style);
    const score = imagePriorityScore(w, h);

    const src = el.getAttribute("src");
    const srcset = el.getAttribute("srcset");
    const candidates = [
      ...(src ? [src] : []),
      ...extractSrcsetUrls(srcset ?? undefined),
      ...extractUrlsFromStyle(style),
    ];
    for (const raw of candidates) {
      const url = normalizeAbsoluteHttpUrl(raw);
      if (!url) continue;
      if (isParsedThumbTooSmall(w, h)) continue;
      if (isNoiseImageUrl(url, { width: w, height: h, displayNone })) continue;
      const prev = bucket.get(url) ?? 0;
      bucket.set(url, Math.max(score, prev));
    }
  }

  for (const pic of root.querySelectorAll("picture")) {
    for (const srcEl of pic.querySelectorAll("source")) {
      const srcset = srcEl.getAttribute("srcset");
      for (const raw of extractSrcsetUrls(srcset ?? undefined)) {
        const url = normalizeAbsoluteHttpUrl(raw);
        if (!url) continue;
        if (isNoiseImageUrl(url, { width: null, height: null, displayNone: false }))
          continue;
        const prev = bucket.get(url) ?? 0;
        bucket.set(url, Math.max(prev, 0));
      }
    }
  }

  for (const meta of root.querySelectorAll("meta")) {
    const prop = meta.getAttribute("property")?.toLowerCase();
    const name = meta.getAttribute("name")?.toLowerCase();
    if (prop !== "og:image" && name !== "twitter:image") continue;
    const content = meta.getAttribute("content");
    if (!content?.trim()) continue;
    const url = normalizeAbsoluteHttpUrl(content);
    if (!url) continue;
    if (isNoiseImageUrl(url, { width: null, height: null, displayNone: false }))
      continue;
    const prev = bucket.get(url) ?? 0;
    bucket.set(url, Math.max(prev, 10_000));
  }
}

/** Tier 1 + optional meta when single-listing doc matches. */
function walkScopedTier1(
  root: HTMLElement,
  listingUrl: string,
  matchingAnchors: HTMLElement[],
  allowOgMeta: boolean,
): Map<string, number> {
  const bucket = new Map<string, number>();

  for (const el of root.querySelectorAll("img")) {
    const hel = el as HTMLElement;
    if (minDistanceToAnyAnchor(hel, matchingAnchors) > MAX_DOM_DISTANCE) continue;

    const w = parseDim(el.getAttribute("width"));
    const h = parseDim(el.getAttribute("height"));
    const style = el.getAttribute("style") ?? undefined;
    const displayNone = styleHasDisplayNone(style);
    const score = imagePriorityScore(w, h);

    const src = el.getAttribute("src");
    const srcset = el.getAttribute("srcset");
    const candidates = [
      ...(src ? [src] : []),
      ...extractSrcsetUrls(srcset ?? undefined),
      ...extractUrlsFromStyle(style),
    ];
    for (const raw of candidates) {
      const url = normalizeAbsoluteHttpUrl(raw);
      if (!url) continue;
      if (isParsedThumbTooSmall(w, h)) continue;
      if (isNoiseImageUrl(url, { width: w, height: h, displayNone })) continue;
      const prev = bucket.get(url) ?? 0;
      bucket.set(url, Math.max(score, prev));
    }
  }

  for (const pic of root.querySelectorAll("picture")) {
    for (const srcEl of pic.querySelectorAll("source")) {
      const hel = srcEl as HTMLElement;
      if (minDistanceToAnyAnchor(hel, matchingAnchors) > MAX_DOM_DISTANCE) continue;
      const srcset = srcEl.getAttribute("srcset");
      for (const raw of extractSrcsetUrls(srcset ?? undefined)) {
        const url = normalizeAbsoluteHttpUrl(raw);
        if (!url) continue;
        if (isNoiseImageUrl(url, { width: null, height: null, displayNone: false }))
          continue;
        const prev = bucket.get(url) ?? 0;
        bucket.set(url, Math.max(prev, 0));
      }
    }
  }

  if (allowOgMeta) {
    for (const meta of root.querySelectorAll("meta")) {
      const prop = meta.getAttribute("property")?.toLowerCase();
      const name = meta.getAttribute("name")?.toLowerCase();
      if (prop !== "og:image" && name !== "twitter:image") continue;
      const content = meta.getAttribute("content");
      if (!content?.trim()) continue;
      const url = normalizeAbsoluteHttpUrl(content);
      if (!url) continue;
      if (isNoiseImageUrl(url, { width: null, height: null, displayNone: false }))
        continue;
      const prev = bucket.get(url) ?? 0;
      bucket.set(url, Math.max(prev, 10_000));
    }
  }

  return bucket;
}

/** Tier 2: any image in doc whose URL contains listing key (DOM not required). */
function walkTier2Token(
  root: HTMLElement,
  listingKey: string,
): Map<string, number> {
  const bucket = new Map<string, number>();

  const tryAdd = (
    url: string,
    w: number | null,
    h: number | null,
    displayNone: boolean,
  ) => {
    if (!imageUrlContainsBoundListingKey(url, listingKey)) return;
    if (isParsedThumbTooSmall(w, h)) return;
    if (isNoiseImageUrl(url, { width: w, height: h, displayNone })) return;
    const score = imagePriorityScore(w, h);
    const prev = bucket.get(url) ?? 0;
    bucket.set(url, Math.max(score, prev));
  };

  for (const el of root.querySelectorAll("img")) {
    const w = parseDim(el.getAttribute("width"));
    const h = parseDim(el.getAttribute("height"));
    const style = el.getAttribute("style") ?? undefined;
    const displayNone = styleHasDisplayNone(style);
    const src = el.getAttribute("src");
    const srcset = el.getAttribute("srcset");
    for (const raw of [
      ...(src ? [src] : []),
      ...extractSrcsetUrls(srcset ?? undefined),
      ...extractUrlsFromStyle(style),
    ]) {
      const url = normalizeAbsoluteHttpUrl(raw);
      if (url) tryAdd(url, w, h, displayNone);
    }
  }

  for (const pic of root.querySelectorAll("picture")) {
    for (const srcEl of pic.querySelectorAll("source")) {
      const srcset = srcEl.getAttribute("srcset");
      for (const raw of extractSrcsetUrls(srcset ?? undefined)) {
        const url = normalizeAbsoluteHttpUrl(raw);
        if (url) tryAdd(url, null, null, false);
      }
    }
  }

  return bucket;
}

/**
 * Images scoped to one property detail URL (Tier 1 DOM, Tier 2 URL token, Tier 3 single-listing global).
 */
export function extractListingImageCandidatesForListing(
  html: string,
  listingUrl: string,
): string[] {
  if (!html.trim() || !listingUrl.trim()) return [];
  const listingNorm = normalizePropertyUrlForMatch(listingUrl);
  if (!listingNorm) return [];

  let root: HTMLElement;
  try {
    root = parse(html, { lowerCaseTagName: true }) as HTMLElement;
  } catch {
    return [];
  }

  const propertyCount = countDistinctPropertyListingUrls(root);
  const matchingAnchors = collectMatchingAnchors(root, listingUrl);
  const listingMatchesSingleton =
    propertyCount === 1 &&
    (() => {
      const only = singletonPropertyListingUrl(root);
      return only ? hrefMatchesListing(only, listingUrl) : false;
    })();

  const allowOgMeta = propertyCount === 1 && listingMatchesSingleton;

  const tier1 = walkScopedTier1(
    root,
    listingUrl,
    matchingAnchors,
    allowOgMeta,
  );
  if (tier1.size > 0) return bucketToSortedLimited(tier1);

  const token = extractListingKeyToken(listingUrl);
  if (token) {
    const tier2 = walkTier2Token(root, token);
    if (tier2.size > 0) return bucketToSortedLimited(tier2);
  }

  if (listingMatchesSingleton) {
    const tier3 = new Map<string, number>();
    walkGlobalImagesIntoBucket(root, tier3);
    if (tier3.size > 0) return bucketToSortedLimited(tier3);
  }

  return [];
}

/**
 * Unscoped extraction: only when the document contains exactly one property listing URL
 * (Tier 3 safety — avoids mixing multi-listing digest images).
 */
export function extractListingImageCandidatesFromHtml(html: string): string[] {
  if (!html.trim()) return [];
  let root: HTMLElement;
  try {
    root = parse(html, { lowerCaseTagName: true }) as HTMLElement;
  } catch {
    return [];
  }
  const single = singletonPropertyListingUrl(root);
  if (!single) return [];
  return extractListingImageCandidatesForListing(html, single);
}

/**
 * All absolute http(s) hrefs from <a> tags (decoded HTML).
 */
export function extractHttpHrefsFromHtml(html: string): string[] {
  if (!html.trim()) return [];
  let root: HTMLElement;
  try {
    root = parse(html, { lowerCaseTagName: true }) as HTMLElement;
  } catch {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href?.trim()) continue;
    const url = normalizeAbsoluteHttpUrl(href);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function isPortalListingHref(href: string): boolean {
  return (
    href.includes("rightmove.co.uk") ||
    href.includes("zoopla.co.uk") ||
    href.includes("onthemarket.com") ||
    href.includes("primelocation.com") ||
    href.includes("ostrich.co.uk") ||
    href.includes("themodernhouse.com")
  );
}

/**
 * Max length for the email body portion before listing URLs / images are appended.
 */
export function maxBodyCharsForLlm(): number {
  return Math.max(2000, MAX_INPUT_CHARS - RESERVE_SUFFIX_CHARS);
}
