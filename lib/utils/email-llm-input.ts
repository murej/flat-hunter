import {
  preprocessString,
  preprocessWithOptions,
  toLlmContext,
} from "langmail";

// Maximum byte size of the context string fed to the listing/verification LLM.
// Langmail's HTML→Markdown conversion is aggressive, so 32 KB is generous.
const MAX_LLM_BYTES = 32 * 1024;

// Cap raw input to langmail to avoid pathological processing of huge emails.
const MAX_RAW_INPUT_CHARS = 256_000;

// href-based URL extraction — direct portal URLs only (host starts with portal domain).
// Excludes tracking redirects like url9467.comms-2.zoopla.co.uk which also contain "zoopla.co.uk".
const PORTAL_HREF_RE =
  /href\s*=\s*["'](https?:\/\/(?:www\.)?(?:rightmove\.co\.uk|zoopla\.co\.uk|onthemarket\.com|primelocation\.com)[^"']*)["']/gi;
// Zoopla tracking CTA links — only anchors whose content is visible text, not purely an <img>.
// Captures the href AND the first part of the anchor's inner content for filtering.
const TRACKING_HREF_WITH_TEXT_RE =
  /href\s*=\s*["'](https?:\/\/[^"']+\/ls\/click\?[^"']*)["'][^>]*>((?!<img)[^<]{2,})/gi;
// Bare portal listing URL patterns for plain-text emails
const PORTAL_BARE_URL_RE =
  /https?:\/\/(?:www\.)?(?:rightmove\.co\.uk\/properties\/\d+|zoopla\.co\.uk\/for-sale\/details\/\d+|onthemarket\.com\/details\/[^\s<>"'&]+|primelocation\.com\/for-sale\/details\/\d+)[^\s<>"'&]*/gi;
// Any https href — used by verification heuristics to find verify/confirm links
const ALL_HREF_RE = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

/**
 * Build an LLM-ready email context from CloudMailin JSON parts.
 *
 * Constructs a synthetic RFC 5322 message so langmail can strip HTML noise,
 * tracking pixels, and boilerplate. Portal listing URLs (which langmail strips
 * from rendered link text) are re-appended in a dedicated section.
 *
 * Satisfies: plain-vs-HTML selection (prefer HTML for structure, fall back to
 * plain), URL discovery with fallback, and byte-capping — all in one pass.
 */
export function buildLlmContextFromParts(
  html: string,
  subject?: string,
  plain?: string,
): string {
  const bodySource = html || plain || "";
  if (!bodySource) return "(empty email)";

  const rfc822 = buildSyntheticRfc822(bodySource, subject);
  const processed = preprocessWithOptions(
    Buffer.from(rfc822.slice(0, MAX_RAW_INPUT_CHARS)),
    { maxBodyLength: 0 }, // no internal truncation; we truncate at the end
  );
  let context = toLlmContext(processed);

  // Re-append portal/tracking URLs that langmail stripped from link rendering
  const urls = extractListingUrls(html || plain || "");
  if (urls.length > 0) {
    context += "\n\nListing URLs:\n" + urls.join("\n");
  }

  return truncateLlmContext(context);
}

/**
 * Extract HTML, plain text, and subject from a raw RFC 5322 message.
 * Used by the webhook handler to get stable inputs for idempotency and storage
 * without triggering langmail processing (that happens later in the agent).
 */
export async function extractMimeParts(rawMessage: string): Promise<{
  html: string;
  plain: string;
  subject: string;
}> {
  const { default: PostalMime } = await import("postal-mime");
  const mimeResult = await PostalMime.parse(rawMessage);
  return {
    html: mimeResult.html ?? "",
    plain: mimeResult.text ?? "",
    subject: mimeResult.subject ?? "",
  };
}

/**
 * Build an LLM-ready email context from a raw RFC 5322 message string.
 * Also returns the HTML/text body for storage and idempotency use.
 *
 * Used when CloudMailin is configured to deliver the raw message.
 */
export async function buildLlmContextFromRaw(rawMessage: string): Promise<{
  context: string;
  html: string;
  plain: string;
  subject: string;
}> {
  const { default: PostalMime } = await import("postal-mime");
  const mimeResult = await PostalMime.parse(rawMessage);
  const html = mimeResult.html ?? "";
  const plain = mimeResult.text ?? "";
  const subject = mimeResult.subject ?? "";

  // langmail gets the real RFC822 — best quote/signature stripping
  const processed = preprocessWithOptions(
    Buffer.from(rawMessage.slice(0, MAX_RAW_INPUT_CHARS)),
    { maxBodyLength: 0 },
  );
  let context = toLlmContext(processed);

  const urls = extractListingUrls(html || plain || rawMessage);
  if (urls.length > 0) {
    context += "\n\nListing URLs:\n" + urls.join("\n");
  }

  return {
    context: truncateLlmContext(context),
    html,
    plain,
    subject,
  };
}

/**
 * Extract portal listing URLs and Zoopla tracking URLs from an HTML/text source.
 *
 * Used to supplement langmail's body (which strips hrefs) for the LLM context,
 * and by the Zoopla tracking-link redirect fallback.
 */
export function extractListingUrls(source: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const add = (url: string) => {
    const cleaned = url.trim().replace(/[.,;:!?)]+$/, "");
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  };

  // href-based (most reliable for HTML)
  for (const m of source.matchAll(
    new RegExp(PORTAL_HREF_RE.source, PORTAL_HREF_RE.flags),
  )) {
    add(m[1] ?? "");
  }
  // Only include tracking links whose anchor wraps visible text (not pure image links).
  // This filters out image-thumbnail tracking URLs (duplicates of the CTA link)
  // and prevents the LLM from seeing ~12 indistinguishable tracking URLs.
  for (const m of source.matchAll(
    new RegExp(
      TRACKING_HREF_WITH_TEXT_RE.source,
      TRACKING_HREF_WITH_TEXT_RE.flags,
    ),
  )) {
    add(m[1] ?? "");
  }

  // bare URL extraction for plain-text emails
  for (const m of source.matchAll(
    new RegExp(PORTAL_BARE_URL_RE.source, PORTAL_BARE_URL_RE.flags),
  )) {
    add(m[0] ?? "");
  }

  return result;
}

/**
 * Extract all https href URLs from an HTML source.
 * Used by verification heuristics to find verify/confirm links.
 */
export function extractAllHrefs(html: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of html.matchAll(
    new RegExp(ALL_HREF_RE.source, ALL_HREF_RE.flags),
  )) {
    const url = (m[1] ?? "").trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

function buildSyntheticRfc822(body: string, subject?: string): string {
  const headers = [
    "From: sender@unknown.invalid",
    subject ? `Subject: ${subject}` : "",
    "Content-Type: text/html; charset=utf-8",
  ]
    .filter(Boolean)
    .join("\r\n");
  return headers + "\r\n\r\n" + body;
}

function truncateLlmContext(context: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });
  const buf = enc.encode(context);
  if (buf.length <= MAX_LLM_BYTES) return context;
  return dec.decode(buf.subarray(0, MAX_LLM_BYTES)) + "\n\n[... truncated ...]";
}
