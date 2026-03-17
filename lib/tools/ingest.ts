import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin, getPreferences } from "@/lib/supabase";
import { retryWithBackoff } from "@/lib/utils/retry";
import { EMAIL_PARSER_SYSTEM, EMAIL_VERIFICATION_DETECTOR_SYSTEM } from "@/lib/prompts";
import {
  runEvaluationPipeline,
  type EvaluationPipelineResult,
} from "./evaluator";
import { composeScorecard, composeNoScoreScorecard } from "./scorecard";
import { sleep } from "@/lib/utils/retry";
import { sendMessage } from "@/lib/telegram";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RawListing {
  portal_id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  description: string;
  image_urls: string[];
  floorplan_url: string;
  agent_name: string;
  agent_email: string;
  listed_date: string;
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

  if (error) {
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

export async function parseEmailHtml(html: string): Promise<RawListing[]> {
  const response = await retryWithBackoff(() =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: EMAIL_PARSER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Parse the following property alert email HTML and extract all listings:\n\n${html}`,
        },
      ],
    }),
  );

  const text =
    response.content[0].type === "text" ? response.content[0].text : "[]";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse listings JSON from Claude response");
    return [];
  }
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
  const toInsert = listings.filter((l) => {
    if (existingPortalIds.has(l.portal_id) || seenInBatch.has(l.portal_id))
      return false;
    seenInBatch.add(l.portal_id);
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
  plain?: string
): Promise<{ isVerification: boolean; verificationUrl?: string }> {
  const parts: string[] = [];
  if (subject) parts.push(`Subject: ${subject}\n`);
  if (html) parts.push(`Email HTML:\n\n${html}`);
  if (plain && plain !== html) parts.push(`\nPlain text:\n\n${plain}`);
  const content = parts.join("\n") || "(empty email)";

  const response = await retryWithBackoff(() =>
    client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: EMAIL_VERIFICATION_DETECTOR_SYSTEM,
      messages: [{ role: "user", content }],
    }),
  );

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { isVerification: false };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      isVerification?: boolean;
      verificationUrl?: string;
    };
    return {
      isVerification: Boolean(parsed.isVerification),
      verificationUrl:
        typeof parsed.verificationUrl === "string"
          ? parsed.verificationUrl
          : undefined,
    };
  } catch {
    console.error("Failed to parse verification JSON from Claude response");
    return { isVerification: false };
  }
}

export type IngestResult =
  | { done: true }
  | { done: false; newIds: string[] };

export async function ingestAgent(
  html: string,
  subject?: string,
  plain?: string
): Promise<IngestResult> {
  const key = computeIdempotencyKey(html, subject);
  if (!(await claimIdempotencyKey(key))) {
    return { done: true };
  }

  // Check verification first (saves listing-parse call for verification emails)
  const verification = await parseVerificationEmail(html, subject, plain);
  if (verification.isVerification) {
    if (verification.verificationUrl) {
      await sendMessage(
        `📬 New subscription detected. Please click the link below to verify your email:\n\n${verification.verificationUrl}`,
      );
    } else {
      await sendMessage(
        "📬 This looks like a verification email. Please check your inbox and click the verification link to activate your alerts.",
      );
    }
    return { done: true };
  }

  const listings = await parseEmailHtml(html);

  if (listings.length === 0) {
    await sendMessage(
      "Couldn't find any listings in this email — it may not be a property alert, or the format wasn't recognized.",
    );
    return { done: true };
  }

  const newIds = await deduplicateAndStore(listings);

  if (newIds.length === 0) {
    await sendMessage(
      "📬 Email alert processed — no new properties (all were duplicates).",
    );
    return { done: true };
  }

  return { done: false, newIds };
}

export async function runEvaluationsAndNotify(
  newIds: string[]
): Promise<void> {
  const preferences = await getPreferences();

  if (!preferences) {
    await sendMessage(
      `I have *${newIds.length}* new ${newIds.length === 1 ? "listing" : "listings"} — set your preferences via Telegram to get scorecards.`,
    );
    return;
  }

  await sendMessage(
    "I have new listings, will get back to you if there's anything worth checking out.",
  );

  const evalResults = await Promise.all(
    newIds.map((id) =>
      runEvaluationPipeline(id, { sendImmediately: false }).catch((e) => {
        console.error(`Evaluation failed for ${id}:`, e);
        return null;
      }),
    ),
  );

  const results = evalResults.filter(
    (r): r is EvaluationPipelineResult => r !== null && typeof r === "object",
  );

  const toSend = results
    .filter((r) => r.sent)
    .sort((a, b) => b.overall_score - a.overall_score);

  const SCORECARD_DELAY_MS = parseInt(
    process.env.SCORECARD_DELAY_MS ?? "500",
    10,
  );

  for (let i = 0; i < toSend.length; i++) {
    const r = toSend[i];
    if (r.shouldSendNoScore) {
      await composeNoScoreScorecard(r.evaluation, r.listing);
    } else {
      await composeScorecard(
        r.evaluation,
        r.listing,
        r.notable_flags,
        r.commute_minutes,
        r.unknownScores,
      );
    }
    if (i < toSend.length - 1) {
      await sleep(SCORECARD_DELAY_MS);
    }
  }

  const sentCount = toSend.length;
  const suppressedCount = results.length - sentCount;

  await sendMessage(
    suppressedCount > 0
      ? `📬 Email alert processed: *${newIds.length}* new ${newIds.length === 1 ? "property" : "properties"} — showing *${sentCount}* scorecard${sentCount === 1 ? "" : "s"}, plus *${suppressedCount}* more that scored 5/10 or below.`
      : `📬 Email alert processed: *${newIds.length}* new ${newIds.length === 1 ? "property" : "properties"} — showing *${sentCount}* scorecard${sentCount === 1 ? "" : "s"}.`,
  );
}
