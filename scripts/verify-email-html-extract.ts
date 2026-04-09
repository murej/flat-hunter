/**
 * Regression checks for email HTML image/href extraction (run: npx tsx scripts/verify-email-html-extract.ts).
 */
import assert from "node:assert/strict";
import {
  decodeQuotedPrintable,
  decodeQuotedPrintableIfNeeded,
  extractHttpHrefsFromHtml,
  extractListingImageCandidatesFromHtml,
  extractSrcsetUrls,
  looksQuotedPrintable,
  normalizeAbsoluteHttpUrl,
} from "../lib/agents/ingest/email-html-extract";

function must(cond: unknown, msg: string): asserts cond {
  assert.ok(cond, msg);
}

// --- normalizeAbsoluteHttpUrl ---
must(
  normalizeAbsoluteHttpUrl("https://lid.zoocdn.com/x.jpg")?.includes("zoocdn"),
  "absolute https",
);
must(normalizeAbsoluteHttpUrl("/foo.jpg") === null, "relative rejected");
must(normalizeAbsoluteHttpUrl("data:image/png;base64,xx") === null, "data rejected");
must(
  normalizeAbsoluteHttpUrl("javascript:alert(1)") === null,
  "javascript rejected",
);
must(
  normalizeAbsoluteHttpUrl(
    "https://example.com/a?x=1&amp;y=2",
  )?.includes("&y=2"),
  "entity decode in query",
);

// --- srcset ---
{
  const s = extractSrcsetUrls(" https://a.com/1.jpg 200w, https://b.com/2.png 400w ");
  assert.deepEqual(s, ["https://a.com/1.jpg", "https://b.com/2.png"]);
}

// --- QP ---
{
  const qp = 'href=3D"https://lid.zoocdn.com/a.jpg"';
  must(looksQuotedPrintable(qp), "detect qp");
  must(decodeQuotedPrintableIfNeeded("plain") === "plain", "skip plain");
  const dec = decodeQuotedPrintable(qp);
  must(dec.includes("https://lid.zoocdn.com/a.jpg"), "decode qp href");
}

// --- Hero + Mailchimp-style beacon ---
{
  const html = `
  <html><body>
  <img src="https://ostrich.us20.list-manage.com/track/open.php?u=x&id=y" width="1" height="1" style="display:none" alt="" />
  <img src="https://lid.zoocdn.com/645/430/abc123.jpg" width="268" height="200" />
  </body></html>`;
  const urls = extractListingImageCandidatesFromHtml(html);
  must(urls.length >= 1, "at least hero");
  must(urls[0].includes("lid.zoocdn.com"), "hero first");
  must(!urls.some((u) => u.includes("list-manage")), "beacon dropped");
}

// --- og:image ---
{
  const html =
    '<head><meta property="og:image" content="https://cdn.example.com/hero.webp" /></head>';
  const urls = extractListingImageCandidatesFromHtml(html);
  must(urls.some((u) => u.includes("cdn.example.com")), "og:image");
}

// --- Malformed / unclosed img ---
{
  const html =
    '<img src="https://ok.example.com/p.jpg" ><p>Hi<img src="https://second.example.com/q.png">';
  const urls = extractListingImageCandidatesFromHtml(html);
  must(urls.length >= 2, "two imgs from broken html");
}

// --- hrefs ---
{
  const html =
    '<a href="https://www.zoopla.co.uk/for-sale/details/123">x</a><a href="/rel">y</a>';
  const hrefs = extractHttpHrefsFromHtml(html);
  must(hrefs.some((h) => h.includes("zoopla")), "portal href");
  must(hrefs.length === 1, "relative skipped");
}

// --- Path contains "track/open" must not false-positive as beacon ---
{
  const html =
    '<img src="https://img.example.com/track/open-house.jpg" width="400" height="300" />';
  const urls = extractListingImageCandidatesFromHtml(html);
  must(urls.some((u) => u.includes("open-house")), "track/open-house kept");
}

console.log("verify-email-html-extract: OK");
