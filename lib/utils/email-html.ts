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
