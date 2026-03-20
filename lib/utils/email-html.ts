import { convert } from "html-to-text";

const HREF_REGEX = /href\s*=\s*["']([^"']+)["']/gi;
const SRC_REGEX = /src\s*=\s*["']([^"']+)["']/gi;
const HTTP_URL_REGEX = /^https?:\/\//i;

function extractUrls(html: string): { links: string[]; images: string[] } {
  const links: string[] = [];
  const images: string[] = [];
  const seenLinks = new Set<string>();
  const seenImages = new Set<string>();

  for (const m of Array.from(html.matchAll(HREF_REGEX))) {
    const url = m[1].trim();
    if (HTTP_URL_REGEX.test(url) && !seenLinks.has(url)) {
      seenLinks.add(url);
      links.push(url);
    }
  }

  for (const m of Array.from(html.matchAll(SRC_REGEX))) {
    const url = m[1].trim();
    if (HTTP_URL_REGEX.test(url) && !seenImages.has(url)) {
      seenImages.add(url);
      images.push(url);
    }
  }

  return { links, images };
}

/**
 * Extracts plain text and URLs (from links and images) from HTML.
 * Returns the input unchanged if it does not look like HTML.
 */
export function extractTextAndUrlsFromHtml(html: string): string {
  if (!html || !html.includes("<") || !html.includes(">")) {
    return html;
  }

  const text = convert(html, {
    wordwrap: false,
  }).replace(/\s+/g, " ").trim();

  const { links, images } = extractUrls(html);

  const parts: string[] = [];
  if (text) parts.push(text);
  if (links.length > 0) {
    parts.push("\n\nLinks:");
    for (const url of links) parts.push(url);
  }
  if (images.length > 0) {
    parts.push("\n\nImages:");
    for (const url of images) parts.push(url);
  }

  return parts.join("\n") || html;
}

const SNIPPET_BYTES_BEFORE = 6000;
const SNIPPET_BYTES_AFTER = 24000;
const SNIPPET_MAX_BYTES = 64 * 1024;
const FULL_BODY_MAX_BYTES = 256 * 1024;

function truncateUtf8(str: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });
  const buf = enc.encode(str);
  if (buf.length <= maxBytes) return str;
  return dec.decode(buf.subarray(0, maxBytes));
}

function looksLikeHtml(body: string): boolean {
  return body.includes("<") && body.includes(">");
}

function urlSearchCandidates(listingUrl: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  add(listingUrl);
  add(listingUrl.replace(/&/g, "&amp;"));
  add(listingUrl.replace(/&amp;/g, "&"));
  try {
    const path = new URL(listingUrl).pathname;
    if (path && path.length > 1) add(path);
  } catch {
    /* ignore */
  }
  return out;
}

function findUrlInHtml(html: string, listingUrl: string): number {
  for (const candidate of urlSearchCandidates(listingUrl)) {
    const i = html.indexOf(candidate);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Picks a bounded slice of the email body around the listing URL when present,
 * otherwise the full body. All results are UTF-8 byte-capped for storage.
 */
export function extractRelevantListingHtml(
  body: string,
  listingUrl: string,
): string {
  if (!body) return "";

  if (!looksLikeHtml(body)) {
    return truncateUtf8(body, FULL_BODY_MAX_BYTES);
  }

  const idx = findUrlInHtml(body, listingUrl);
  if (idx < 0) {
    return truncateUtf8(body, FULL_BODY_MAX_BYTES);
  }

  const start = Math.max(0, idx - SNIPPET_BYTES_BEFORE);
  const end = Math.min(body.length, idx + SNIPPET_BYTES_AFTER);
  const slice = body.slice(start, end);
  return truncateUtf8(slice, SNIPPET_MAX_BYTES);
}
