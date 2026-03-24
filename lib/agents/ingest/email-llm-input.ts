import { preprocessString, toLlmContext } from "langmail";
import PostalMime from "postal-mime";
import { annotateUrlWithPortalId } from "./portal-id";
import { LISTING_URL_PATTERN_SOURCES, INGEST_LISTING_URLS_SECTION_HEADING } from "./config";

const MAX_INPUT_CHARS = 32_000;

export type LlmContextResult = {
  context: string;
  truncated: boolean;
};

type MimeParts = {
  html: string;
  plain: string;
  subject: string;
};

export async function extractMimeParts(
  rawMessage: string,
): Promise<MimeParts> {
  const parser = new PostalMime();
  const email = await parser.parse(rawMessage);
  return {
    html: email.html || "",
    plain: email.text || "",
    subject: email.subject || "",
  };
}

export function extractListingUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const src of LISTING_URL_PATTERN_SOURCES) {
    const pattern = new RegExp(src, "g");
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) urls.add(m);
    }
  }
  return [...urls];
}

export function extractAllHrefs(html: string): string[] {
  const hrefPattern = /href="([^"]+)"/g;
  const hrefs: string[] = [];
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    hrefs.push(match[1]);
  }
  return hrefs;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function buildLlmContextFromParts(
  html: string,
  subject?: string,
  plain?: string,
): LlmContextResult {
  // Extract text from HTML, preferring plain text if available
  const bodyText = plain || (html ? stripHtmlTags(html) : "");
  let context = "";
  let truncated = false;

  if (subject) context += `Subject: ${subject}\n\n`;
  context += bodyText;

  if (context.length > MAX_INPUT_CHARS) {
    truncated = true;
    context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
  }

  // Extract and append listing URLs from original HTML
  const allText = html + " " + (plain || "");
  const urls = extractListingUrls(allText);
  const hrefs = html ? extractAllHrefs(html) : [];
  const listingHrefs = hrefs.filter(
    (h) =>
      h.includes("rightmove.co.uk") ||
      h.includes("zoopla.co.uk") ||
      h.includes("onthemarket.com") ||
      h.includes("primelocation.com"),
  );

  const allUrls = [...new Set([...urls, ...listingHrefs])];
  if (allUrls.length > 0) {
    const annotated = allUrls.map(annotateUrlWithPortalId);
    context += `\n\n${INGEST_LISTING_URLS_SECTION_HEADING}:\n${annotated.join("\n")}`;
  }

  return { context, truncated };
}

export async function buildLlmContextFromRaw(
  rawMessage: string,
): Promise<LlmContextResult> {
  // Use langmail for RFC 5322 raw email processing
  try {
    const processed = preprocessString(rawMessage);
    let context = toLlmContext(processed);
    let truncated = false;

    // Extract direct listing URLs and all hrefs from the raw message
    const urls = extractListingUrls(rawMessage);
    const hrefs = extractAllHrefs(rawMessage);
    const listingHrefs = hrefs.filter(
      (h) =>
        h.includes("rightmove.co.uk") ||
        h.includes("zoopla.co.uk") ||
        h.includes("onthemarket.com") ||
        h.includes("primelocation.com"),
    );
    const allUrls = [...new Set([...urls, ...listingHrefs])];
    if (allUrls.length > 0) {
      const annotated = allUrls.map(annotateUrlWithPortalId);
      context += `\n\n${INGEST_LISTING_URLS_SECTION_HEADING}:\n${annotated.join("\n")}`;
    }

    if (context.length > MAX_INPUT_CHARS) {
      truncated = true;
      context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
    }

    return { context, truncated };
  } catch {
    // Fallback to postal-mime if langmail fails
    const parts = await extractMimeParts(rawMessage);
    return buildLlmContextFromParts(parts.html, parts.subject, parts.plain);
  }
}
