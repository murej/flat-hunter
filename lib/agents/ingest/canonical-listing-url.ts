import { normalizeAbsoluteHttpUrl } from "./email-html-extract";

/**
 * Normalize known portal URLs to stable public detail pages (host, path shape, trailing slash).
 * Called after {@link normalizeAbsoluteHttpUrl} in ingest validation.
 */
export function canonicalizeListingUrl(raw: string): string {
  const abs = normalizeAbsoluteHttpUrl(raw);
  if (!abs) return raw.trim();

  try {
    const u = new URL(abs);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "ostrich.co.uk") {
      const mSingular = u.pathname.match(/^\/property\/([a-z0-9-]+)\/?$/i);
      if (mSingular) {
        return `https://ostrich.co.uk/properties/${mSingular[1]}`;
      }
      const mPlural = u.pathname.match(/^\/properties\/([a-z0-9-]+)\/?$/i);
      if (mPlural) {
        return `https://ostrich.co.uk/properties/${mPlural[1]}`;
      }
      return abs;
    }

    if (host === "themodernhouse.com") {
      u.hostname = "themodernhouse.com";
      const sales = u.pathname.match(/^\/sales-list\/([a-z0-9-]+)\/?$/i);
      if (sales) {
        const slug = sales[1].toLowerCase();
        return `https://themodernhouse.com/sales-list/${slug}/`;
      }
      const prop = u.pathname.match(/^\/property\/([a-z0-9-]+)\/?$/i);
      if (prop) {
        let slug = prop[1].toLowerCase();
        slug = slug.replace(/-london-[a-z0-9]+$/i, "");
        return `https://themodernhouse.com/sales-list/${slug}/`;
      }
      return abs;
    }

    return abs;
  } catch {
    return abs;
  }
}

function ostrichPropertiesSlug(url: string): string | null {
  const abs = normalizeAbsoluteHttpUrl(url);
  if (!abs) return null;
  try {
    const p = new URL(abs).pathname;
    const m = p.match(/^\/properties\/([a-z0-9-]+)\/?$/i);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/**
 * When an email links to the same Ostrich listing twice (SEO slug vs id slug), keep the URL whose
 * last path segment is longest — e.g. prefer …/upper-bardsey-walk-de087 over …-canonbury-n1.
 */
export function dedupeOstrichPropertyUrlsBySlugQuality(urls: string[]): string[] {
  if (urls.length < 2) return urls;

  const ostrichUrls = urls.filter((u) => /ostrich\.co\.uk\/properties\//i.test(u));
  if (ostrichUrls.length < 2) return urls;

  const groups = new Map<string, string>();

  for (const url of ostrichUrls) {
    const slug = ostrichPropertiesSlug(url);
    if (!slug) continue;
    const parts = slug.split("-");
    if (parts.length < 4) continue;

    const key = parts.slice(0, 3).join("-");
    const last = parts[parts.length - 1]!;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, url);
      continue;
    }
    const exSlug = ostrichPropertiesSlug(existing);
    if (!exSlug) {
      groups.set(key, url);
      continue;
    }
    const exLast = exSlug.split("-").pop()!;
    if (last.length > exLast.length) groups.set(key, url);
  }

  const drop = new Set<string>();
  for (const url of ostrichUrls) {
    const slug = ostrichPropertiesSlug(url);
    if (!slug) continue;
    const parts = slug.split("-");
    if (parts.length < 4) continue;
    const key = parts.slice(0, 3).join("-");
    const winner = groups.get(key);
    if (winner && url !== winner) drop.add(url);
  }

  if (drop.size === 0) return urls;
  return urls.filter((u) => !drop.has(u));
}
