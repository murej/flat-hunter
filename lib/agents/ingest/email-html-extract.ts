import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { MAX_INPUT_CHARS } from "./config";

/** Max image URLs appended to LLM context (each line is one URL). */
export const MAX_IMAGE_CANDIDATES = 24;

const RESERVE_SUFFIX_CHARS = 6000;

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

  // ESP / newsletter open tracking (avoid broad "/track/" path rules — can match real assets).
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

function imagePriorityScore(width: number | null, height: number | null): number {
  if (width != null && height != null && width > 0 && height > 0) {
    return width * height;
  }
  return 0;
}

type ScoredUrl = { url: string; score: number };

function walkImgAndPicture(root: HTMLElement, bucket: Map<string, number>) {
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
      if (isNoiseImageUrl(url, { width: w, height: h, displayNone })) continue;
      const prev = bucket.get(url) ?? 0;
      const s = Math.max(score, prev);
      bucket.set(url, s);
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

/**
 * Extract likely listing / marketing image URLs from decoded email HTML.
 */
export function extractListingImageCandidatesFromHtml(html: string): string[] {
  if (!html.trim()) return [];
  let root: HTMLElement;
  try {
    root = parse(html, { lowerCaseTagName: true }) as HTMLElement;
  } catch {
    return [];
  }

  const bucket = new Map<string, number>();
  walkImgAndPicture(root, bucket);

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
