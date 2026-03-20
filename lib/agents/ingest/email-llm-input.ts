import { preprocessString, toLlmContext } from "langmail";
import PostalMime from "postal-mime";

const MAX_INPUT_CHARS = 32_000;

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
  const patterns = [
    /https?:\/\/(?:www\.)?rightmove\.co\.uk\/properties\/\d+/g,
    /https?:\/\/(?:www\.)?zoopla\.co\.uk\/for-sale\/details\/\d+/g,
    /https?:\/\/(?:www\.)?onthemarket\.com\/details\/\d+/g,
    /https?:\/\/(?:www\.)?primelocation\.com\/for-sale\/details\/\d+/g,
  ];

  const urls = new Set<string>();
  for (const pattern of patterns) {
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
): string {
  // Extract text from HTML, preferring plain text if available
  const bodyText = plain || (html ? stripHtmlTags(html) : "");
  let context = "";

  if (subject) context += `Subject: ${subject}\n\n`;
  context += bodyText;

  if (context.length > MAX_INPUT_CHARS) {
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
    context += `\n\nDetected listing URLs:\n${allUrls.join("\n")}`;
  }

  return context;
}

export async function buildLlmContextFromRaw(
  rawMessage: string,
): Promise<string> {
  // Use langmail for RFC 5322 raw email processing
  try {
    const processed = preprocessString(rawMessage);
    let context = toLlmContext(processed);

    // Also extract listing URLs from the raw message
    const urls = extractListingUrls(rawMessage);
    if (urls.length > 0) {
      context += `\n\nDetected listing URLs:\n${urls.join("\n")}`;
    }

    if (context.length > MAX_INPUT_CHARS) {
      context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
    }

    return context;
  } catch {
    // Fallback to postal-mime if langmail fails
    const parts = await extractMimeParts(rawMessage);
    return buildLlmContextFromParts(parts.html, parts.subject, parts.plain);
  }
}
