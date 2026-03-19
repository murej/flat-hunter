import { createHash } from "crypto";
import pLimit from "p-limit";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin, getPreferences } from "@/lib/supabase";
import { retryWithBackoff } from "@/lib/utils/retry";
import { extractTextAndUrlsFromHtml } from "@/lib/utils/email-html";
import {
  EMAIL_PARSER_SYSTEM,
  EMAIL_VERIFICATION_DETECTOR_SYSTEM,
} from "./prompts";
import { runAgent } from "@/lib/core/agent";
import {
  runEvaluationPipeline,
  type EvaluationPipelineResult,
} from "@/lib/tools/evaluation-pipeline";
import {
  buildScorecardText,
  buildNoScoreScorecardText,
  buildScorecardButtons,
} from "@/lib/tools/scorecard";
import { consumePendingNotifications } from "@/lib/agents/notifications";

export const MAX_LISTINGS_PER_EMAIL = 100;

const MAX_EMAIL_CONTENT_BYTES = 40 * 1024; // 40KB — balance parse quality vs context

export interface RawListing {
  portal_id: string;
  url: string;
  title: string;
  price: number | null;
  address: string;
  postcode: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  description: string;
  image_urls: string[];
  floorplan_url: string;
  agent_name: string;
  agent_email: string;
  listed_date: string;
}

export async function enqueueOneOffMessage(
  text: string,
  options?: { parse_mode?: false },
): Promise<void> {
  const batchId = crypto.randomUUID();
  await supabaseAdmin.from("pending_notifications").insert({
    batch_id: batchId,
    sequence: 0,
    type: "intro",
    payload: {
      kind: "one_off",
      text,
      ...(options?.parse_mode === false ? { parse_mode: false } : {}),
    },
  });
  if (process.env.VERCEL) {
    waitUntil(consumePendingNotifications(batchId));
  } else {
    await consumePendingNotifications(batchId);
  }
}

export function computeIdempotencyKey(html: string, subject?: string): string {
  return createHash("sha256")
    .update(html + (subject ?? ""))
    .digest("hex");
}

export async function claimIdempotencyKey(key: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("ingest_idempotency")
    .insert({ idempotency_key: key });

  if (!error) {
    return true;
  }

  if ((error as { code?: string }).code === "23505") {
    return false;
  }

  console.error("Failed to claim ingest idempotency key:", error);
  throw error;
}

function buildEmailParseExtractedContent(html: string): string {
  let content = extractTextAndUrlsFromHtml(html);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  if (bytes.length > MAX_EMAIL_CONTENT_BYTES) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    content =
      decoder.decode(bytes.subarray(0, MAX_EMAIL_CONTENT_BYTES)) +
      "\n\n[... truncated for token limit ...]";
  }
  return content;
}

function buildClaudeEmailParseInput(html: string): string {
  const content = buildEmailParseExtractedContent(html);
  return `Parse the following property alert email (text and URLs extracted from HTML) and extract all listings:\n\n${content}`;
}

export async function parseEmailHtml(html: string): Promise<RawListing[]> {
  const tParse0 = Date.now();
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:parseEmailHtml',message:'parseEmailHtml entry',data:{tParse0,htmlLen:html.length},hypothesisId:'H1,H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
  const claudeInput = buildClaudeEmailParseInput(html);

  const result = await retryWithBackoff(() =>
    runAgent({
      systemPrompt: EMAIL_PARSER_SYSTEM,
      prompt: claudeInput,
      model: "claude-haiku-4-5",
    }),
  );

  const text = "message" in result ? result.message : "[]";
  const tParse1 = Date.now();
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:parseEmailHtml',message:'claude parse done',data:{tParse1,claudeMs:tParse1-tParse0},hypothesisId:'H1,H4',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion

  function extractFirstValidJsonArrayCandidate(
    input: string,
    startIndices: number[],
  ): string | null {
    for (const start of startIndices) {
      let depth = 0;
      let inString = false;

      for (let i = start; i < input.length; i++) {
        const ch = input[i];

        if (inString) {
          if (ch === "\\") {
            i++; // skip escaped char
            continue;
          }
          if (ch === '"') inString = false;
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === "[") depth++;
        if (ch === "]") {
          depth--;
          if (depth === 0) {
            const candidate = input.slice(start, i + 1);

            try {
              const parsed = JSON.parse(candidate);
              if (Array.isArray(parsed)) return candidate;
            } catch {
              // fall through to sanitization
            }

            const sanitized = candidate
              .replace(/,\s*]/g, "]")
              .replace(/,\s*}/g, "}");
            try {
              const parsed = JSON.parse(sanitized);
              if (Array.isArray(parsed)) return sanitized;
            } catch {
              // try next start index
            }
            break;
          }
        }
      }
    }

    return null;
  }

  const jsonStartIndices: number[] = [];
  for (let i = 0; i < text.length && jsonStartIndices.length < 8; i++) {
    if (text[i] === "[") jsonStartIndices.push(i);
  }

  const jsonArrayCandidate = extractFirstValidJsonArrayCandidate(
    text,
    jsonStartIndices,
  );
  if (!jsonArrayCandidate) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonArrayCandidate);
  } catch (e) {
    const sanitized = jsonArrayCandidate
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");
    try {
      parsed = JSON.parse(sanitized);
    } catch {
      console.error(
        "Failed to parse listings JSON from Claude response (even after sanitization):",
        e,
      );
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  function derivePortalIdFromUrl(url: string): string {
    const detailsMatch = url.match(/\/for-sale\/details\/(\d+)/i);
    if (detailsMatch?.[1]) return `zoopla:${detailsMatch[1]}`;
    return `generated:${createHash("sha256").update(url).digest("hex")}`;
  }

  const listings: RawListing[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const l = item as Partial<RawListing>;
    if (!l.url) continue;

    const url = String(l.url);
    const portalId = l.portal_id
      ? String(l.portal_id)
      : derivePortalIdFromUrl(url);

    listings.push({
      portal_id: portalId,
      url,
      title: String(l.title ?? ""),
      price: typeof l.price === "number" && l.price > 0 ? l.price : null,
      address: String(l.address ?? ""),
      postcode: String(l.postcode ?? ""),
      bedrooms:
        typeof l.bedrooms === "number" && l.bedrooms >= 0 ? l.bedrooms : null,
      bathrooms:
        typeof l.bathrooms === "number" && l.bathrooms >= 0
          ? l.bathrooms
          : null,
      sqft: typeof l.sqft === "number" && l.sqft >= 0 ? l.sqft : null,
      description: String(l.description ?? ""),
      image_urls: Array.isArray(l.image_urls)
        ? l.image_urls.map((u) => String(u))
        : [],
      floorplan_url: String(l.floorplan_url ?? ""),
      agent_name: String(l.agent_name ?? ""),
      agent_email: String(l.agent_email ?? ""),
      listed_date:
        typeof l.listed_date === "string" && l.listed_date
          ? l.listed_date
          : new Date().toISOString().slice(0, 10),
    });
  }

  // Zoopla alert emails often provide only tracking links (e.g. /ls/click?upn=...),
  // and Claude may fail to return usable listing objects. As a fallback, resolve
  // those tracking links by following redirects to the real /for-sale/details/<id> URL.
  if (listings.length === 0) {
    const tZoopl0 = Date.now();
    // #region agent log
    (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:parseEmailHtml',message:'zoopla fallback entry',data:{tZoopl0},hypothesisId:'H3',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
    // #endregion
    try {
      const extracted = buildEmailParseExtractedContent(html);
      const priceCandidates = Array.from(
        extracted.matchAll(/£\s*([0-9]{1,3}(?:,[0-9]{3})*)/g),
      )
        .map((m) => {
          const raw = m[1] ?? "";
          const cleaned = raw.replace(/,/g, "");
          const n = parseInt(cleaned, 10);
          return Number.isFinite(n) ? n : null;
        })
        .filter((n): n is number => n !== null);

      const trackingUrls = Array.from(
        extracted.matchAll(
          /https?:\/\/[^\s<>"']+\/ls\/click\?[^ \n\r\t<>"']+/gi,
        ),
      ).map((m) => m[0]);

      const uniqueTrackingUrls = Array.from(new Set(trackingUrls));
      const toResolve = uniqueTrackingUrls.slice(0, 8);

      const resolveRedirect = async (u: string): Promise<string | null> => {
        try {
          const res = await fetch(u, {
            method: "GET",
            redirect: "follow",
            headers: { "user-agent": "flat-hunter/ingest" },
        });
          return res.url ?? null;
        } catch {
          return null;
        }
      };

      const resolved = await Promise.all(
        toResolve.map((u) => resolveRedirect(u)),
      );
      const tZoopl1 = Date.now();
      // #region agent log
      (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:parseEmailHtml',message:'zoopla fallback redirects done',data:{tZoopl1,zooplaMs:tZoopl1-tZoopl0,toResolve:toResolve.length},hypothesisId:'H3',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
      // #endregion
      const detailUrls = resolved
        .map((finalUrl) => finalUrl ?? "")
        .filter(Boolean)
        .filter((finalUrl) => /\/for-sale\/details\//i.test(finalUrl));

      const derivedListings: RawListing[] = detailUrls.map((detailUrl, idx) => {
        const m = detailUrl.match(/\/for-sale\/details\/(\d+)/i);
        const id = m?.[1];
        const portal_id = id
          ? `zoopla:${id}`
          : `generated:${createHash("sha256").update(detailUrl).digest("hex")}`;

        const price = priceCandidates[idx] ?? null;

        return {
          portal_id,
          url: detailUrl,
          title: "",
          price,
          address: "",
          postcode: "",
          bedrooms: null,
          bathrooms: null,
          sqft: null,
          description: "",
          image_urls: [],
          floorplan_url: "",
          agent_name: "",
          agent_email: "",
          listed_date: new Date().toISOString().slice(0, 10),
        };
      });

      if (derivedListings.length > 0) listings.push(...derivedListings);
    } catch (e) {
      console.error("Zoopla tracking fallback failed:", e);
    }
  }

  return listings;
}

export async function deduplicateAndStore(
  listings: RawListing[],
): Promise<string[]> {
  if (listings.length === 0) return [];

  const portalIds = Array.from(new Set(listings.map((l) => l.portal_id)));

  const { data: existing } = await supabaseAdmin
    .from("listings")
    .select("portal_id")
    .in("portal_id", portalIds);

  const existingPortalIds = new Set(
    (existing ?? []).map((r) => r.portal_id as string),
  );

  const seenInBatch = new Set<string>();
  const urlAddressKey = (l: RawListing) =>
    `${l.url}::${l.address}`.toLowerCase();
  const seenUrlAddress = new Set<string>();

  const toInsert = listings.filter((l) => {
    const alreadySeenId =
      existingPortalIds.has(l.portal_id) || seenInBatch.has(l.portal_id);
    const key = urlAddressKey(l);
    const alreadySeenUrlAddress = seenUrlAddress.has(key);

    if (alreadySeenId || alreadySeenUrlAddress) {
      return false;
    }

    seenInBatch.add(l.portal_id);
    seenUrlAddress.add(key);
    return true;
  });
  if (toInsert.length === 0) return [];

  const rows = toInsert.map((listing) => ({
    portal_id: listing.portal_id,
    url: listing.url,
    title: listing.title,
    price: listing.price,
    address: listing.address,
    postcode: listing.postcode,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    sqft: listing.sqft,
    description: listing.description,
    image_urls: listing.image_urls,
    floorplan_url: listing.floorplan_url,
    agent_name: listing.agent_name,
    agent_email: listing.agent_email,
    listed_date: listing.listed_date,
    status: "pending_evaluation",
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("listings")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("Failed to batch insert listings:", error);
    return [];
  }

  return (inserted ?? []).map((r) => r.id as string);
}

export async function parseVerificationEmail(
  html: string,
  subject?: string,
  plain?: string,
): Promise<{
  isVerification: boolean;
  verificationUrl?: string;
  verificationCode?: string;
}> {
  const parts: string[] = [];
  if (subject) parts.push(`Subject: ${subject}\n`);
  if (html)
    parts.push(
      `Email content (text and URLs):\n\n${extractTextAndUrlsFromHtml(html)}`,
    );
  if (plain && plain !== html) parts.push(`\nPlain text:\n\n${plain}`);
  const fullContent = parts.join("\n") || "(empty email)";

  const safeSubject = typeof subject === "string" ? subject : "";

  if (/verify|confirm|activation/i.test(safeSubject)) {
    const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
    let urls = Array.from(fullContent.matchAll(hrefRegex), (m) => m[1]);
    if (urls.length === 0) {
      urls = (fullContent.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) =>
        u.replace(/[.,;:!?)]+$/, ""),
      );
    }
    const verificationUrl =
      urls.length > 0
        ? (urls.find((u) =>
            /rightmove|zoopla|onthemarket|primelocation|verify|confirm|token|subscription/i.test(
              u,
            ),
          ) ?? urls[0])
        : undefined;
    const codeMatch = fullContent.match(/\b(\d{6})\b/);
    const verificationCode = codeMatch?.[1];
    if (verificationUrl || verificationCode) {
      return {
        isVerification: true,
        verificationUrl,
        verificationCode: verificationUrl ? undefined : verificationCode,
      };
    }
  }

  const content =
    fullContent.length > 8000
      ? fullContent.slice(0, 8000) + "\n\n[... truncated for token limit ...]"
      : fullContent;

  const tVer0 = Date.now();
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:parseVerificationEmail',message:'parseVerificationEmail claude call',data:{tVer0},hypothesisId:'H5',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
  const result = await retryWithBackoff(() =>
    runAgent({
      systemPrompt: EMAIL_VERIFICATION_DETECTOR_SYSTEM,
      prompt: content,
      model: "claude-sonnet-4-6",
    }),
  );

  const text = "message" in result ? result.message : "";
  if (!text) {
    return { isVerification: false };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { isVerification: false };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      isVerification?: boolean;
      verificationUrl?: string;
      verificationCode?: string;
    };
    let verificationUrl: string | undefined =
      typeof parsed.verificationUrl === "string"
        ? parsed.verificationUrl
        : undefined;
    let verificationCode: string | undefined =
      typeof parsed.verificationCode === "string"
        ? parsed.verificationCode
        : undefined;

    // Fallback: extract URL or code from content when LLM detects verification but didn't extract both
    // Always try URL first when missing — LLM may wrongly return only verificationCode for link-based emails
    if (Boolean(parsed.isVerification) && !verificationUrl) {
      const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
      let urls = Array.from(fullContent.matchAll(hrefRegex), (m) => m[1]);
      if (urls.length === 0) {
        urls = (fullContent.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) =>
          u.replace(/[.,;:!?)]+$/, ""),
        );
      }
      if (urls.length > 0) {
        verificationUrl =
          urls.find((u) =>
            /rightmove|zoopla|onthemarket|primelocation|verify|confirm|token|subscription/i.test(
              u,
            ),
          ) ?? urls[0];
      }
      if (!verificationUrl && !verificationCode) {
        const codeMatch = fullContent.match(/\b(\d{6})\b/);
        if (codeMatch) verificationCode = codeMatch[1];
      }
    }

    let isVerification = Boolean(parsed.isVerification);

    // Fallback: LLM may return false for verification emails. When subject suggests verification, try URL extraction first, then code.
    if (!isVerification && /verify|confirm|activation/i.test(safeSubject)) {
      if (!verificationUrl) {
        const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
        let urls = Array.from(fullContent.matchAll(hrefRegex), (m) => m[1]);
        if (urls.length === 0) {
          urls = fullContent.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
          urls = urls.map((u) => u.replace(/[.,;:!?)]+$/, ""));
        }
        if (urls.length > 0) {
          verificationUrl =
            urls.find((u) =>
              /rightmove|zoopla|onthemarket|primelocation|verify|confirm|token|subscription/i.test(
                u,
              ),
            ) ?? urls[0];
          isVerification = true;
        }
      }
      if (!isVerification && fullContent.match(/\b\d{6}\b/)) {
        const codeMatch = fullContent.match(/\b(\d{6})\b/);
        if (codeMatch) {
          isVerification = true;
          verificationCode = verificationCode ?? codeMatch[1];
        }
      }
    }

    return {
      isVerification,
      verificationUrl,
      verificationCode,
    };
  } catch {
    console.error("Failed to parse verification JSON from Claude response");
    return { isVerification: false };
  }
}

export type IngestResult = { done: true } | { done: false; newIds: string[] };

export async function runEvaluationsAndNotify(newIds: string[]): Promise<void> {
  const tEval0 = Date.now();
  // #region agent log
  (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:runEvaluationsAndNotify',message:'runEvaluationsAndNotify entry',data:{tEval0,newIdsLen:newIds.length},hypothesisId:'H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
  // #endregion
  try {
    const batchId = crypto.randomUUID();
    const preferences = await getPreferences();

    if (!preferences) {
      const text = `I have *${newIds.length}* new ${newIds.length === 1 ? "listing" : "listings"} — set your preferences via Telegram to get scorecards.`;
      await supabaseAdmin.from("pending_notifications").insert({
        batch_id: batchId,
        sequence: 0,
        type: "intro",
        payload: { kind: "no_prefs", text },
      });
      if (process.env.VERCEL) {
        waitUntil(consumePendingNotifications(batchId));
      } else {
        await consumePendingNotifications(batchId);
      }
      return;
    }

    const idsToProcess = newIds.slice(0, MAX_LISTINGS_PER_EMAIL);
    const truncated = newIds.length > MAX_LISTINGS_PER_EMAIL;

    const rows: Array<{
      batch_id: string;
      sequence: number;
      type: "intro" | "scorecard" | "summary";
      payload: Record<string, unknown>;
    }> = [];
    let seq = 0;

    const limit = pLimit(5);
    const evalResults = await Promise.all(
      idsToProcess.map((id) =>
        limit(() =>
          runEvaluationPipeline(id).catch((e) => {
            console.error(`Evaluation failed for ${id}:`, e);
            return null;
          }),
        ),
      ),
    );
    const tEval1 = Date.now();
    // #region agent log
    (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:runEvaluationsAndNotify',message:'eval pipeline completed',data:{tEval1,evalPipelineMs:tEval1-tEval0,idsProcessed:idsToProcess.length},hypothesisId:'H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
    // #endregion

    const results = evalResults.filter(
      (r): r is EvaluationPipelineResult => r !== null && typeof r === "object",
    );

    const rateLimitHit = results.some((r) => r.rateLimitHit);
    const introText = truncated
      ? `I have *${newIds.length}* new listings — processing first ${MAX_LISTINGS_PER_EMAIL}. Will get back to you if there's anything worth checking out.`
      : "I have new listings, will get back to you if there's anything worth checking out.";
    const introWithRateLimit =
      rateLimitHit
        ? `${introText}\n\n⚠️ _Rate limit hit — some evaluations used fallback scores. Try again in a few minutes._`
        : introText;
    rows.push({
      batch_id: batchId,
      sequence: seq++,
      type: "intro",
      payload: {
        kind: truncated ? "truncated" : "new_listings",
        text: introWithRateLimit,
        ...(truncated ? { truncatedTotal: newIds.length } : {}),
      },
    });

    const toSend = results
      .filter((r) => r.sent)
      .sort((a, b) => b.overall_score - a.overall_score);

    for (const r of toSend) {
      const scorecardText = r.shouldSendNoScore
        ? buildNoScoreScorecardText(r.evaluation, r.listing)
        : buildScorecardText(
            r.evaluation,
            r.listing,
            r.notable_flags,
            r.commute_minutes,
            r.unknownScores,
          );
      const buttons = buildScorecardButtons(
        r.listing.id,
        r.listing.status === "saved",
      );
      rows.push({
        batch_id: batchId,
        sequence: seq++,
        type: "scorecard",
        payload: {
          listingId: r.listing.id,
          scorecardText,
          buttons,
          overall_score: r.overall_score,
          shouldSendNoScore: r.shouldSendNoScore,
        },
      });
    }

    const sentCount = toSend.length;
    const suppressedCount = results.length - sentCount;
    const rejected = results.filter((r) => !r.sent);
    const rejectedDetails =
      rejected.length > 0
        ? rejected
            .map(
              (r) =>
                `[${r.listing.title}](${r.listing.url}) (${r.overall_score}/10)`,
            )
            .join(", ")
        : "";

    const processedCount = idsToProcess.length;
    const summaryText =
      suppressedCount > 0
        ? `📬 Email alert processed: *${processedCount}* new ${
            processedCount === 1 ? "property" : "properties"
          }${truncated ? ` (of ${newIds.length})` : ""} — showing *${sentCount}* scorecard${
            sentCount === 1 ? "" : "s"
          }, plus *${suppressedCount}* more that scored 7/10 or below: ${rejectedDetails}.`
        : `📬 Email alert processed: *${processedCount}* new ${
            processedCount === 1 ? "property" : "properties"
          }${truncated ? ` (of ${newIds.length})` : ""} — showing *${sentCount}* scorecard${
            sentCount === 1 ? "" : "s"
          }.`;

    rows.push({
      batch_id: batchId,
      sequence: seq++,
      type: "summary",
      payload: {
        text: summaryText,
        ...(suppressedCount > 0
          ? { link_preview_options: { is_disabled: true } }
          : {}),
      },
    });

    await supabaseAdmin.from("pending_notifications").insert(rows);
    const tEval2 = Date.now();
    // #region agent log
    (()=>{const p={sessionId:'c2b00b',location:'lib/agents/ingest/tools.ts:runEvaluationsAndNotify',message:'runEvaluationsAndNotify exit',data:{tEval2,totalEvalMs:tEval2-tEval0},hypothesisId:'H2',timestamp:Date.now()};fetch('http://127.0.0.1:7790/ingest/52ceec03-3746-4d68-bfe2-e446cee5c158',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c2b00b'},body:JSON.stringify(p)}).catch(()=>{});if(process.env.VERCEL)console.log('[debug c2b00b]',JSON.stringify(p));})();
    // #endregion
    if (process.env.VERCEL) {
      waitUntil(consumePendingNotifications(batchId));
    } else {
      await consumePendingNotifications(batchId);
    }
  } catch (e) {
    throw e;
  }
}
