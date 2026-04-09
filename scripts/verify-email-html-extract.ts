/**
 * Regression checks for email HTML image/href extraction (run: npx tsx scripts/verify-email-html-extract.ts).
 */
import assert from "node:assert/strict";
import {
  decodeQuotedPrintable,
  decodeQuotedPrintableIfNeeded,
  extractHttpHrefsFromHtml,
  extractListingImageCandidatesForListing,
  extractListingImageCandidatesFromHtml,
  extractListingKeyToken,
  filterPersistedListingImageUrls,
  extractSrcsetUrls,
  hrefMatchesListing,
  imageUrlContainsBoundListingKey,
  looksQuotedPrintable,
  normalizeAbsoluteHttpUrl,
  normalizePropertyUrlForMatch,
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

// --- normalizePropertyUrlForMatch / hrefMatchesListing ---
{
  const a = "https://www.zoopla.co.uk/for-sale/details/72828163?utm_source=x";
  const b = "https://zoopla.co.uk/for-sale/details/72828163";
  must(
    normalizePropertyUrlForMatch(a) === normalizePropertyUrlForMatch(b),
    "strip utm and www-equivalent host path",
  );
  must(hrefMatchesListing(a, b), "href matches listing");
}

// --- srcset ---
{
  const s = extractSrcsetUrls(" https://a.com/1.jpg 200w, https://b.com/2.png 400w ");
  assert.deepEqual(s, ["https://a.com/1.jpg", "https://b.com/2.png"]);
}

// --- filterPersistedListingImageUrls (DB row cleanup) ---
{
  const cleaned = filterPersistedListingImageUrls([
    "https://lid.zoocdn.com/645/430/keep.jpg",
    "https://go.advantage.zpg.co.uk/l/143391/x/Zoopla_Logo.png",
    "https://mns.asrvkeez.com/imp/2/47145/x/1",
  ]);
  assert.deepEqual(cleaned, ["https://lid.zoocdn.com/645/430/keep.jpg"]);
}

// --- QP ---
{
  const qp = 'href=3D"https://lid.zoocdn.com/a.jpg"';
  must(looksQuotedPrintable(qp), "detect qp");
  must(decodeQuotedPrintableIfNeeded("plain") === "plain", "skip plain");
  const dec = decodeQuotedPrintable(qp);
  must(dec.includes("https://lid.zoocdn.com/a.jpg"), "decode qp href");
}

const Z999 = "https://www.zoopla.co.uk/for-sale/details/99999";

// --- Hero + Mailchimp-style beacon (scoped to listing URL) ---
{
  const html = `
  <html><body><div>
  <a href="${Z999}">View</a>
  <img src="https://ostrich.us20.list-manage.com/track/open.php?u=x&id=y" width="1" height="1" style="display:none" alt="" />
  <img src="https://lid.zoocdn.com/645/430/abc123.jpg" width="268" height="200" />
  </div></body></html>`;
  const urls = extractListingImageCandidatesForListing(html, Z999);
  must(urls.length >= 1, "at least hero");
  must(urls[0].includes("lid.zoocdn.com"), "hero first");
  must(!urls.some((u) => u.includes("list-manage")), "beacon dropped");
}

// --- extractListingImageCandidatesFromHtml: single listing in doc ---
{
  const html = `<a href="${Z999}">x</a><img src="https://lid.zoocdn.com/x.jpg" width="200" height="200"/>`;
  const urls = extractListingImageCandidatesFromHtml(html);
  must(urls.some((u) => u.includes("lid.zoocdn.com")), "singleton unscoped");
}

// --- og:image only when single listing matches ---
{
  const html = `<head><meta property="og:image" content="https://cdn.example.com/hero.webp" /></head>
    <body><a href="${Z999}">x</a></body>`;
  const urls = extractListingImageCandidatesForListing(html, Z999);
  must(urls.some((u) => u.includes("cdn.example.com")), "og:image with single listing");
}

// --- og:image + two listing links: do not assign og to scoped extract for one URL ---
{
  const u1 = "https://www.zoopla.co.uk/for-sale/details/11111001";
  const u2 = "https://www.zoopla.co.uk/for-sale/details/22222002";
  const html = `<head><meta property="og:image" content="https://cdn.example.com/shared.webp" /></head>
    <body>
    <table><tr><td><a href="${u1}">A</a><img src="https://lid.zoocdn.com/a/a111.jpg" width="200" height="150"/></td></tr>
    <tr><td><a href="${u2}">B</a><img src="https://lid.zoocdn.com/b/b222.jpg" width="200" height="150"/></td></tr></table>
    </body>`;
  const for1 = extractListingImageCandidatesForListing(html, u1);
  const for2 = extractListingImageCandidatesForListing(html, u2);
  must(for1.some((u) => u.includes("a111")), "row A image");
  must(for2.some((u) => u.includes("b222")), "row B image");
  must(!for1.includes("https://cdn.example.com/shared.webp"), "no shared og for A");
  must(!for2.includes("https://cdn.example.com/shared.webp"), "no shared og for B");
}

// --- Malformed / unclosed img + single listing anchor ---
{
  const u = "https://www.zoopla.co.uk/for-sale/details/88888";
  const html = `<a href="${u}">x</a><img src="https://ok.example.com/p.jpg" ><p>Hi<img src="https://second.example.com/q.png">`;
  const urls = extractListingImageCandidatesForListing(html, u);
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
  const u = "https://www.zoopla.co.uk/for-sale/details/77777";
  const html = `<a href="${u}">x</a><img src="https://img.example.com/track/open-house.jpg" width="400" height="300" />`;
  const urls = extractListingImageCandidatesForListing(html, u);
  must(urls.some((u) => u.includes("open-house")), "track/open-house kept");
}

// --- Tier 2: listing id in image URL, DOM far from anchor ---
{
  const longId = "76543210001";
  const listing = `https://www.zoopla.co.uk/for-sale/details/${longId}`;
  const deep = "<div>".repeat(80) + `<img src="https://lid.zoocdn.com/x/${longId}/photo.jpg" width="300" height="200"/>` + "</div>".repeat(80);
  const html = `<a href="${listing}">top</a>${deep}`;
  const urls = extractListingImageCandidatesForListing(html, listing);
  must(urls.some((u) => u.includes(longId)), "tier2 token match");
}

// --- Tier 3: one listing link, two imgs (loosely associated — same singleton doc) ---
{
  const u = "https://www.zoopla.co.uk/for-sale/details/33333003";
  const html = `<table><tr><td><a href="${u}">x</a></td></tr></table>
    <p>below</p><img src="https://img.example.com/one.png" width="200" height="200"/>
    <img src="https://img.example.com/two.png" width="200" height="200"/>`;
  const urls = extractListingImageCandidatesForListing(html, u);
  must(urls.length >= 2, "tier3 fills when single listing");
  must(urls.some((x) => x.includes("one.png")), "tier3 img one");
}

// --- extractListingKeyToken ---
must(extractListingKeyToken("https://www.zoopla.co.uk/for-sale/details/72828163") === "72828163", "key token");

// --- Bound listing key in image URL (avoid hash substring false positives) ---
must(
  imageUrlContainsBoundListingKey(
    "https://lid.zoocdn.com/x/72828163/thumb.jpg",
    "72828163",
  ),
  "segment match",
);
must(
  !imageUrlContainsBoundListingKey(
    "https://lid.zoocdn.com/a/172828163b00/c.jpg",
    "72828163",
  ),
  "no substring false positive",
);

// --- Drop CloudFront / Zoopla static logos (email layout, not listing photos) ---
{
  const u = "https://www.zoopla.co.uk/for-sale/details/99999111";
  const html = `<div><a href="${u}">x</a>
  <img src="https://lid.zoocdn.com/400/300/goodhash.jpg" width="300" height="300"/>
  <img src="https://d15k2d11r6t6rl.cloudfront.net/public/users/Integrators/669d5713-9b6a-46bb-bd7e-c542cff6dd6a/x/iconRight%20%281%29.png" width="300" height="300"/>
  <img src="https://st.zoocdn.com/zoopla_static_agent_logo_(762287).png" width="120" height="40"/>
  </div>`;
  const urls = extractListingImageCandidatesForListing(html, u);
  must(urls.some((x) => x.includes("goodhash")), "keep lid photo");
  must(!urls.some((x) => x.includes("cloudfront")), "drop integrator icon");
  must(!urls.some((x) => x.includes("static_agent_logo")), "drop agent logo");
}

// --- ZPG logo + impression host (from production zoopla image_urls) ---
{
  const u = "https://www.zoopla.co.uk/for-sale/details/99999222";
  const html = `<div><a href="${u}">x</a>
  <img src="https://lid.zoocdn.com/400/300/keepme.jpg" width="300" height="300"/>
  <img src="https://go.advantage.zpg.co.uk/l/143391/2021-04-15/x/Zoopla_Logo.png" width="200" height="80"/>
  <img src="https://mns.asrvkeez.com/imp/2/47145/a7d58057f45470e573cf412ea76e2e168e561d7a9fb630b894748df9bfc7b566/1775124957160" width="1" height="1"/>
  </div>`;
  const urls = extractListingImageCandidatesForListing(html, u);
  must(urls.some((x) => x.includes("keepme")), "keep lid");
  must(!urls.some((x) => x.includes("advantage.zpg")), "drop zpg short link");
  must(!urls.some((x) => x.includes("asrvkeez")), "drop imp host");
}

// --- WxH path dedupe: same file, keep largest dimensions ---
{
  const u = "https://www.zoopla.co.uk/for-sale/details/33333003";
  const html = `<a href="${u}">x</a>
    <img src="https://lid.zoocdn.com/80/60/samehash.jpg" width="200" height="200"/>
    <img src="https://lid.zoocdn.com/640/480/samehash.jpg" width="200" height="200"/>`;
  const urls = extractListingImageCandidatesForListing(html, u);
  const sameFile = urls.filter((x) => x.includes("samehash"));
  must(sameFile.length === 1, "dedupe WxH variants");
  must(sameFile[0].includes("/640/480/"), "keep largest WxH");
}

console.log("verify-email-html-extract: OK");
