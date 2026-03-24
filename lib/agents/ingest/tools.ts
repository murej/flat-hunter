import { createHash } from "crypto";
import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { parseAgentJsonMessage } from "@/lib/core/parse-agent-output";
import { reportError } from "@/lib/core/reporting";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getIngestParseModel, getEmailVerificationModel, getIngestNotificationModel } from "@/lib/config/agent-models";
import { ListingSchema, VerificationResultSchema } from "@/lib/schemas";
import type { VerificationResultOutput, ListingOutput } from "@/lib/schemas";
import { INGEST_PARSE_SYSTEM, EMAIL_VERIFICATION_SYSTEM, INGEST_NOTIFICATION_SYSTEM } from "./prompts";
import {
  TELEMETRY_TAG_VERIFICATION,
  TELEMETRY_TAG_PARSE,
  TELEMETRY_TAG_NOTIFICATION,
  MAX_PARSE_STEPS,
  MAX_INPUT_CHARS,
  LISTING_URL_PATTERN_SOURCES,
  INGEST_LISTING_URLS_SECTION_HEADING,
} from "./config";
import { preprocessString, toLlmContext } from "langmail";
import PostalMime from "postal-mime";
import { runEvaluationPipeline } from "@/lib/tools/evaluation-pipeline";
import { sleep } from "@/lib/utils/retry";
import { envIntClamped } from "@/lib/utils/env-utils";
import {
  claimListingForEvaluation,
  getEvaluatingStaleMinutes,
  releaseListingEvaluationClaim,
} from "@/lib/supabase/evaluation-claim";
import { sendMarkdown } from "@/lib/telegram";
import { consumePendingNotifications } from "@/lib/agents/notifications";
import { z } from "zod";

/** Row slice from DB for material comparison + refresh update */
type ListingMaterialRow = {
  id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  description: string;
  image_urls: string[] | null;
  floorplan_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  listed_date: string | null;
};

function canonicalListingDataHash(data: {
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  description: string;
  image_urls: string[];
  floorplan_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  listed_date: string | null;
}): string {
  const canonical = {
    url: data.url,
    title: data.title,
    price: data.price,
    address: data.address,
    postcode: data.postcode,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    sqft: data.sqft,
    description: data.description,
    image_urls: [...data.image_urls].sort(),
    floorplan_url: data.floorplan_url,
    agent_name: data.agent_name,
    agent_email: data.agent_email,
    listed_date: data.listed_date,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

/** True when parsed listing matches stored material fields (portal_id already matches). */
function listingMaterialDataUnchanged(
  dbRow: ListingMaterialRow,
  parsed: ListingOutput,
): boolean {
  const fromDb = canonicalListingDataHash({
    url: dbRow.url,
    title: dbRow.title,
    price: dbRow.price,
    address: dbRow.address,
    postcode: dbRow.postcode,
    bedrooms: dbRow.bedrooms,
    bathrooms: dbRow.bathrooms,
    sqft: dbRow.sqft,
    description: dbRow.description,
    image_urls: dbRow.image_urls ?? [],
    floorplan_url: dbRow.floorplan_url,
    agent_name: dbRow.agent_name,
    agent_email: dbRow.agent_email,
    listed_date: dbRow.listed_date,
  });
  const fromParsed = canonicalListingDataHash({
    url: parsed.url,
    title: parsed.title,
    price: parsed.price,
    address: parsed.address,
    postcode: parsed.postcode,
    bedrooms: parsed.bedrooms,
    bathrooms: parsed.bathrooms,
    sqft: parsed.sqft,
    description: parsed.description,
    image_urls: parsed.image_urls,
    floorplan_url: parsed.floorplan_url,
    agent_name: parsed.agent_name,
    agent_email: parsed.agent_email,
    listed_date: parsed.listed_date,
  });
  return fromDb === fromParsed;
}

export function computeIdempotencyKey(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function claimIdempotencyKey(key: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from("ingest_idempotency")
    .insert({ idempotency_key: key });
  // 23505 = unique_violation → already processed
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}

export async function parseVerificationEmail(
  content: string,
): Promise<VerificationResultOutput> {
  const result = await runAgent({
    systemPrompt: EMAIL_VERIFICATION_SYSTEM,
    prompt: content,
    model: getEmailVerificationModel(),
    maxSteps: MAX_PARSE_STEPS,
    telemetryTag: TELEMETRY_TAG_VERIFICATION,
    output: Output.object({ schema: VerificationResultSchema }),
  });
  return (await parseAgentJsonMessage(result.message, {
    source: "ingest/verification",
    telemetryTag: TELEMETRY_TAG_VERIFICATION,
  })) as VerificationResultOutput;
}

export async function parseEmailHtml(
  content: string,
): Promise<ListingOutput[]> {
  const result = await runAgent({
    systemPrompt: INGEST_PARSE_SYSTEM,
    prompt: content,
    model: getIngestParseModel(),
    maxSteps: MAX_PARSE_STEPS,
    telemetryTag: TELEMETRY_TAG_PARSE,
    output: Output.object({ schema: z.array(ListingSchema) }),
  });
  const parsed = (await parseAgentJsonMessage(result.message, {
    source: "ingest/parse",
    telemetryTag: TELEMETRY_TAG_PARSE,
  })) as ListingOutput[];
  // #region agent log
  {
    const portalIds = parsed.map((l) => l.portal_id);
    const urls = parsed.map((l) => l.url?.slice(0, 120) ?? "");
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "616deb",
      },
      body: JSON.stringify({
        sessionId: "616deb",
        runId: "pre-fix",
        hypothesisId: "H5",
        location: "tools.ts:parseEmailHtml",
        message: "LLM parse output summary",
        data: {
          count: parsed.length,
          uniquePortalIds: new Set(portalIds).size,
          uniqueUrls: new Set(urls).size,
          sample: parsed.slice(0, 8).map((l) => ({
            portal_id: String(l.portal_id).slice(0, 32),
            price: l.price,
            urlPrefix: (l.url ?? "").slice(0, 100),
          })),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
  return parsed;
}

const LISTING_MATERIAL_SELECT =
  "id, url, title, price, address, postcode, bedrooms, bathrooms, sqft, description, image_urls, floorplan_url, agent_name, agent_email, listed_date";

export async function deduplicateAndStore(
  listings: ListingOutput[],
): Promise<{ newIds: string[]; unchangedDuplicateCount: number }> {
  const newIds: string[] = [];
  let unchangedDuplicateCount = 0;
  const storeOutcomes: Array<{
    portal_id: string;
    outcome:
      | "inserted"
      | "updated"
      | "unchanged_skip"
      | "insert_conflict"
      | "update_error";
    listingRowId?: string;
  }> = [];

  for (const listing of listings) {
    const { data: existing } = await getSupabaseAdmin()
      .from("listings")
      .select(LISTING_MATERIAL_SELECT)
      .eq("portal_id", listing.portal_id)
      .maybeSingle();

    if (existing) {
      const row = existing as ListingMaterialRow;
      if (listingMaterialDataUnchanged(row, listing)) {
        unchangedDuplicateCount++;
        storeOutcomes.push({
          portal_id: String(listing.portal_id).slice(0, 48),
          outcome: "unchanged_skip",
          listingRowId: String(row.id),
        });
        continue;
      }

      const { error: updateError } = await getSupabaseAdmin()
        .from("listings")
        .update({
          ...listing,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updateError) {
        await reportError(updateError, {
          source: "ingest/deduplicateAndStore",
          telemetryTag: `portal_id:${listing.portal_id}`,
        });
        storeOutcomes.push({
          portal_id: String(listing.portal_id).slice(0, 48),
          outcome: "update_error",
        });
        continue;
      }

      newIds.push(String(row.id));
      storeOutcomes.push({
        portal_id: String(listing.portal_id).slice(0, 48),
        outcome: "updated",
        listingRowId: String(row.id),
      });
      continue;
    }

    const { data: inserted, error } = await getSupabaseAdmin()
      .from("listings")
      .insert({
        ...listing,
        status: "pending_evaluation",
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique_violation on portal_id
      if (error.code === "23505") {
        storeOutcomes.push({
          portal_id: String(listing.portal_id).slice(0, 48),
          outcome: "insert_conflict",
        });
        continue;
      }
      await reportError(error, {
        source: "ingest/deduplicateAndStore",
        telemetryTag: `portal_id:${listing.portal_id}`,
      });
      continue;
    }

    if (inserted) {
      const id = String((inserted as { id: number | string }).id);
      newIds.push(id);
      storeOutcomes.push({
        portal_id: String(listing.portal_id).slice(0, 48),
        outcome: "inserted",
        listingRowId: id,
      });
    }
  }

  // #region agent log
  {
    const portalKeys = listings.map((l) => String(l.portal_id).slice(0, 48));
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "616deb",
      },
      body: JSON.stringify({
        sessionId: "616deb",
        runId: "pre-fix",
        hypothesisId: "H-scorecard-dedup",
        location: "tools.ts:deduplicateAndStore",
        message: "Store outcomes per parsed listing",
        data: {
          parsedCount: listings.length,
          uniquePortalIdsInBatch: new Set(portalKeys).size,
          newIdsLength: newIds.length,
          unchangedDuplicateCount,
          outcomes: storeOutcomes,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  return { newIds, unchangedDuplicateCount };
}

export async function runEvaluationsAndNotify(
  ids: string[],
  opts?: { preClaimed?: boolean },
): Promise<void> {
  if (ids.length === 0) return;

  const preClaimed = opts?.preClaimed ?? false;
  const staleMinutes = getEvaluatingStaleMinutes();

  if (!preClaimed) {
    try {
      const intro = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt: `${ids.length} new listing${ids.length > 1 ? "s" : ""} received. Checking match with your preferences...`,
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: TELEMETRY_TAG_NOTIFICATION,
      });
      await sendMarkdown(intro.message);
    } catch (err) {
      await reportError(err, {
        source: "ingest/runEvaluationsAndNotify",
        telemetryTag: "intro",
      });
    }
  }

  const batchId = crypto.randomUUID();
  let sequence = 0;
  let evaluatedCount = 0;
  const listingGapMs = envIntClamped("EVALUATE_LISTING_GAP_MS", 0, 120_000, 0);

  // Process listings sequentially
  let firstListing = true;
  const evalTrace: Array<{
    id: string;
    claimed: boolean;
    pipelineOk: boolean;
  }> = [];
  for (const id of ids) {
    if (!firstListing && listingGapMs > 0) {
      await sleep(listingGapMs);
    }
    firstListing = false;

    try {
      let claimedOk = true;
      if (!preClaimed) {
        const ok = await claimListingForEvaluation(id, staleMinutes);
        claimedOk = ok;
        if (!ok) {
          evalTrace.push({ id, claimed: false, pipelineOk: false });
          continue;
        }
      }

      try {
        const result = await runEvaluationPipeline(id);
        if (!result) {
          await releaseListingEvaluationClaim(id);
          evalTrace.push({ id, claimed: claimedOk, pipelineOk: false });
          continue;
        }
        evaluatedCount++;
        evalTrace.push({ id, claimed: claimedOk, pipelineOk: true });
        await getSupabaseAdmin().from("pending_notifications").insert({
          batch_id: batchId,
          sequence: sequence++,
          type: "scorecard",
          payload: {
            listing_id: result.listingId,
            text: result.scorecardText,
            buttons: result.scorecardButtons,
            parse_mode: "Markdown",
          },
        });
      } catch (err) {
        await releaseListingEvaluationClaim(id);
        evalTrace.push({ id, claimed: true, pipelineOk: false });
        await reportError(err, {
          source: "ingest/runEvaluationsAndNotify",
          telemetryTag: `listing:${id}`,
        });
      }
    } catch (err) {
      await reportError(err, {
        source: "ingest/runEvaluationsAndNotify",
        telemetryTag: `listing:${id}`,
      });
    }
  }

  // #region agent log
  {
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "616deb",
      },
      body: JSON.stringify({
        sessionId: "616deb",
        runId: "pre-fix",
        hypothesisId: "H-scorecard-eval",
        location: "tools.ts:runEvaluationsAndNotify",
        message: "Evaluation trace",
        data: {
          inputIds: ids,
          evaluatedCount,
          evalTrace,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  try {
    await consumePendingNotifications(batchId);
  } catch (err) {
    await reportError(err, {
      source: "ingest/runEvaluationsAndNotify",
      telemetryTag: "consumePendingNotifications",
    });
  }

  if (evaluatedCount > 1) {
    try {
      const summary = await runAgent({
        systemPrompt: INGEST_NOTIFICATION_SYSTEM,
        prompt: `You just finished evaluating ${evaluatedCount} listings and sent scorecards. Write a short wrap-up message reminding the user to react (like) the ones they want to save.`,
        model: getIngestNotificationModel(),
        maxSteps: 1,
        telemetryTag: TELEMETRY_TAG_NOTIFICATION,
      });
      await sendMarkdown(summary.message);
    } catch (err) {
      await reportError(err, {
        source: "ingest/runEvaluationsAndNotify",
        telemetryTag: "summary",
      });
    }
  }
}

// --- Email → LLM context (CloudMailin / JSON body) ---

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
  const bodyText = plain || (html ? stripHtmlTags(html) : "");
  let context = "";

  if (subject) context += `Subject: ${subject}\n\n`;
  context += bodyText;

  if (context.length > MAX_INPUT_CHARS) {
    context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
  }

  const allText = html + " " + (plain || "");
  const listingUrls = extractListingUrlsFromText(allText);
  if (listingUrls.length > 0) {
    context += `\n\n${INGEST_LISTING_URLS_SECTION_HEADING}:\n${listingUrls.join("\n")}`;
  }

  return context;
}

export async function buildLlmContextFromRaw(
  rawMessage: string,
): Promise<string> {
  try {
    const processed = preprocessString(rawMessage);
    let context = toLlmContext(processed);

    if (context.length > MAX_INPUT_CHARS) {
      context = context.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]";
    }

    const listingUrls = extractListingUrlsFromText(rawMessage);
    if (listingUrls.length > 0) {
      context += `\n\n${INGEST_LISTING_URLS_SECTION_HEADING}:\n${listingUrls.join("\n")}`;
    }

    return context;
  } catch {
    const parts = await extractMimeParts(rawMessage);
    return buildLlmContextFromParts(parts.html, parts.subject, parts.plain);
  }
}

export function extractListingUrls(text: string): string[] {
  return extractListingUrlsFromText(text);
}

// --- Listing URL extraction, validation, repair ---

function listingUrlRegexes(): RegExp[] {
  return LISTING_URL_PATTERN_SOURCES.map((s) => new RegExp(s, "gi"));
}

export function extractListingUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  for (const re of listingUrlRegexes()) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      urls.add(decodeHtmlEntitiesInUrl(m[0]));
    }
  }
  return [...urls];
}

export function decodeHtmlEntitiesInUrl(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function extractAllHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const double = /href="([^"]+)"/gi;
  const single = /href='([^']+)'/gi;
  let m: RegExpExecArray | null;
  while ((m = double.exec(html)) !== null) {
    hrefs.push(decodeHtmlEntitiesInUrl(m[1]));
  }
  while ((m = single.exec(html)) !== null) {
    hrefs.push(decodeHtmlEntitiesInUrl(m[1]));
  }
  return hrefs;
}

function hostnameNoWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function isKnownPortalHostname(host: string): boolean {
  const h = hostnameNoWww(host);
  return (
    h.endsWith("rightmove.co.uk") ||
    h.endsWith("zoopla.co.uk") ||
    h.endsWith("onthemarket.com") ||
    h.endsWith("primelocation.com")
  );
}

function pathMatchesDirectListing(host: string, pathname: string): boolean {
  const h = hostnameNoWww(host);
  const p = pathname.replace(/\/+$/, "") || "/";

  if (h.endsWith("rightmove.co.uk")) {
    return /^\/properties\/\d+$/.test(p) || /^\/properties\/\d+\//.test(pathname);
  }
  if (h.endsWith("zoopla.co.uk")) {
    return (
      /\/(?:for-sale|to-rent)\/details\/\d+/.test(pathname) ||
      /\/details\/\d+/.test(pathname)
    );
  }
  if (h.endsWith("onthemarket.com")) {
    return /^\/details\/\d+$/.test(p) || /^\/details\/\d+\//.test(pathname);
  }
  if (h.endsWith("primelocation.com")) {
    return /\/details\/\d+/.test(pathname);
  }
  return false;
}

export function isLikelyListingUrl(url: string): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(decodeHtmlEntitiesInUrl(trimmed));
  } catch {
    return false;
  }
  if (!isKnownPortalHostname(parsed.hostname)) {
    return false;
  }
  return pathMatchesDirectListing(parsed.hostname, parsed.pathname);
}

/**
 * True when the URL is missing, invalid, or points at a main portal host without a listing detail path.
 * Tracking / non-portal URLs are left false so they are not overwritten.
 */
export function needsListingUrlRepair(url: string): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return true;
  let parsed: URL;
  try {
    parsed = new URL(decodeHtmlEntitiesInUrl(trimmed));
  } catch {
    return true;
  }
  if (!isKnownPortalHostname(parsed.hostname)) {
    return false;
  }
  return !pathMatchesDirectListing(parsed.hostname, parsed.pathname);
}

export const isGenericPortalUrl = needsListingUrlRepair;

export function derivePortalIdAndCanonicalUrl(
  url: string,
): { portal_id: string; url: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(decodeHtmlEntitiesInUrl(url.trim()));
  } catch {
    return null;
  }
  const h = hostnameNoWww(parsed.hostname);
  const path = parsed.pathname;

  if (h.endsWith("rightmove.co.uk")) {
    const m = path.match(/\/properties\/(\d+)/);
    if (m) {
      const id = m[1];
      return {
        portal_id: id,
        url: `https://www.rightmove.co.uk/properties/${id}`,
      };
    }
  }
  if (h.endsWith("zoopla.co.uk")) {
    const m = path.match(/\/details\/(\d+)/);
    if (m) {
      const id = m[1];
      const tenure = /\/to-rent\//.test(path) ? "to-rent" : "for-sale";
      return {
        portal_id: `zoopla-${id}`,
        url: `https://www.zoopla.co.uk/${tenure}/details/${id}/`,
      };
    }
  }
  if (h.endsWith("onthemarket.com")) {
    const m = path.match(/\/details\/(\d+)/);
    if (m) {
      const id = m[1];
      return {
        portal_id: `otm-${id}`,
        url: `https://www.onthemarket.com/details/${id}/`,
      };
    }
  }
  if (h.endsWith("primelocation.com")) {
    const m = path.match(/\/details\/(\d+)/);
    if (m) {
      const id = m[1];
      const tenure = /\/to-rent\//.test(path) ? "to-rent" : "for-sale";
      return {
        portal_id: `pl-${id}`,
        url: `https://www.primelocation.com/${tenure}/details/${id}/`,
      };
    }
  }
  return null;
}

const LONG_ID = /\d{6,}/g;

function digitRuns(s: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(LONG_ID.source, "g");
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

function normalizeUkPostcode(pc: string): string | null {
  const compact = pc.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) return compact;
  return null;
}

function postcodesForListing(listing: ListingOutput): string[] {
  const fromPostcode = normalizeUkPostcode(listing.postcode.trim());
  const fromAddress = listing.address.match(
    /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/gi,
  );
  const set = new Set<string>();
  if (fromPostcode) set.add(fromPostcode);
  if (fromAddress) {
    for (const raw of fromAddress) {
      const n = normalizeUkPostcode(raw);
      if (n) set.add(n);
    }
  }
  return [...set];
}

function pickCandidateForListing(
  listing: ListingOutput,
  candidates: string[],
  totalListings: number,
): string | null {
  if (candidates.length === 0) return null;

  if (totalListings === 1 && candidates.length === 1) {
    return candidates[0];
  }

  const fromPortalId = digitRuns(listing.portal_id);
  const fromBadUrl = digitRuns(listing.url);
  const idCandidates = [...new Set([...fromPortalId, ...fromBadUrl])];

  for (const id of idCandidates) {
    const hits = candidates.filter((c) => c.includes(id));
    if (hits.length === 1) return hits[0];
  }

  const pcs = postcodesForListing(listing);
  for (const pc of pcs) {
    const compact = pc;
    const spaced = `${compact.slice(0, compact.length - 3)} ${compact.slice(-3)}`;
    const hits = candidates.filter(
      (c) =>
        c.toUpperCase().includes(compact) ||
        c.toUpperCase().includes(spaced.toUpperCase()),
    );
    if (hits.length === 1) return hits[0];
  }

  return null;
}

export function repairListingsFromEmailBody(
  listings: ListingOutput[],
  emailText: string,
): ListingOutput[] {
  const candidates = extractListingUrlsFromText(emailText);
  // #region agent log
  {
    const rmInBody = (emailText.match(/rightmove\.co\.uk\/properties\/\d+/gi) ?? [])
      .length;
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "616deb",
      },
      body: JSON.stringify({
        sessionId: "616deb",
        runId: "pre-fix",
        hypothesisId: "H2",
        location: "tools.ts:repairListingsFromEmailBody",
        message: "URL extraction vs email body",
        data: {
          candidateCount: candidates.length,
          rmPropertyPathMatchesInBody: rmInBody,
          candidateSample: candidates.slice(0, 6).map((u) => u.slice(0, 120)),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
  if (candidates.length === 0) return listings;

  const sortedCandidates = [...candidates].sort();

  const rows = listings.map((listing) => {
    const needsRepair = needsListingUrlRepair(listing.url);
    if (!needsRepair) {
      return { listing, picked: null as string | null };
    }

    const picked = pickCandidateForListing(listing, sortedCandidates, listings.length);
    if (!picked) {
      return { listing, picked: null as string | null };
    }

    const derived = derivePortalIdAndCanonicalUrl(picked);
    if (!derived) {
      return { listing: { ...listing, url: picked }, picked };
    }

    return {
      listing: {
        ...listing,
        url: derived.url,
        portal_id: derived.portal_id,
      },
      picked,
    };
  });

  // #region agent log
  {
    fetch("http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "616deb",
      },
      body: JSON.stringify({
        sessionId: "616deb",
        runId: "pre-fix",
        hypothesisId: "H1-H3",
        location: "tools.ts:repairListingsFromEmailBody",
        message: "Per-listing repair decisions",
        data: {
          listingCount: listings.length,
          rows: rows.map((r, i) => ({
            i,
            portal_id: String(r.listing.portal_id).slice(0, 24),
            price: r.listing.price,
            needsRepair: needsListingUrlRepair(
              listings[i]?.url ?? "",
            ),
            urlBefore: (listings[i]?.url ?? "").slice(0, 120),
            picked: r.picked?.slice(0, 120) ?? null,
            urlAfter: r.listing.url.slice(0, 120),
          })),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  return rows.map((r) => r.listing);
}
