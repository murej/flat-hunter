import { preprocessString, toLlmContext } from "langmail";
import PostalMime from "postal-mime";
import { annotateUrlWithPortalId } from "./portal-id";
import {
  LISTING_URL_PATTERN_SOURCES,
  INGEST_LISTING_URLS_SECTION_HEADING,
  MAX_INPUT_CHARS,
} from "./config";
import {
  decodeQuotedPrintableIfNeeded,
  extractHttpHrefsFromHtml,
  extractListingImageCandidatesForListing,
  isPortalListingHref,
  maxBodyCharsForLlm,
} from "./email-html-extract";

export type LlmContextResult = {
  context: string;
  truncated: boolean;
};

type MimeParts = {
  html: string;
  plain: string;
  subject: string;
};

export async function extractMimeParts(rawMessage: string): Promise<MimeParts> {
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

function appendListingAndImageSections(
  base: string,
  htmlDecoded: string,
  plain: string | undefined,
  /** Extra text for regex URL discovery (e.g. raw RFC 5322) so headers/plain parts are scanned. */
  extraRegexHaystack?: string,
): string {
  const allText = htmlDecoded + " " + (plain || "");
  const urlHaystack = extraRegexHaystack
    ? `${allText} ${extraRegexHaystack}`
    : allText;
  const urls = extractListingUrls(urlHaystack);
  const hrefs = htmlDecoded ? extractHttpHrefsFromHtml(htmlDecoded) : [];
  const listingHrefs = hrefs.filter(isPortalListingHref);
  const allUrls = [...new Set([...urls, ...listingHrefs])];

  let context = base;
  if (allUrls.length > 0) {
    const annotated = allUrls.map(annotateUrlWithPortalId);
    context += `\n\n${INGEST_LISTING_URLS_SECTION_HEADING}:\n${annotated.join("\n")}`;
  }

  if (htmlDecoded && allUrls.length > 0) {
    for (const listingUrl of allUrls) {
      const imgs = extractListingImageCandidatesForListing(
        htmlDecoded,
        listingUrl,
      );
      if (imgs.length === 0) continue;
      context += `\n\nProperty image URLs for this listing (${listingUrl}) — use only these for that row's image_urls:\n${imgs.join("\n")}`;
    }
  }

  return context;
}

export function buildLlmContextFromParts(
  html: string,
  subject?: string,
  plain?: string,
): LlmContextResult {
  const htmlDecoded = decodeQuotedPrintableIfNeeded(html);
  const bodyText = plain || (htmlDecoded ? stripHtmlTags(htmlDecoded) : "");
  let truncated = false;

  let context = "";
  if (subject) context += `Subject: ${subject}\n\n`;
  context += bodyText;

  const bodyLimit = maxBodyCharsForLlm();
  if (context.length > bodyLimit) {
    truncated = true;
    context = context.slice(0, bodyLimit) + "\n...[truncated]";
  }

  context = appendListingAndImageSections(context, htmlDecoded, plain);

  if (context.length > MAX_INPUT_CHARS) {
    truncated = true;
    context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
  }

  return { context, truncated };
}

export async function buildLlmContextFromRaw(
  rawMessage: string,
): Promise<LlmContextResult> {
  try {
    const processed = preprocessString(rawMessage);
    let context = toLlmContext(processed);
    let truncated = false;

    const parts = await extractMimeParts(rawMessage);
    const htmlDecoded = decodeQuotedPrintableIfNeeded(parts.html);

    const bodyLimit = maxBodyCharsForLlm();
    if (context.length > bodyLimit) {
      truncated = true;
      context = context.slice(0, bodyLimit) + "\n...[truncated]";
    }

    context = appendListingAndImageSections(
      context,
      htmlDecoded,
      parts.plain,
      rawMessage,
    );

    if (context.length > MAX_INPUT_CHARS) {
      truncated = true;
      context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
    }

    return { context, truncated };
  } catch {
    const parts = await extractMimeParts(rawMessage);
    return buildLlmContextFromParts(parts.html, parts.subject, parts.plain);
  }
}
