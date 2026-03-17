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
