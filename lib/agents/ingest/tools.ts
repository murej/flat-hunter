import { createHash } from "crypto";
import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { supabaseAdmin } from "@/lib/supabase";
import { getIngestParseModel, getEmailVerificationModel, getIngestNotificationModel } from "@/lib/config/agent-models";
import { ListingSchema, VerificationResultSchema } from "@/lib/schemas";
import type { VerificationResultOutput, ListingOutput } from "@/lib/schemas";
import { INGEST_PARSE_SYSTEM, EMAIL_VERIFICATION_SYSTEM, INGEST_NOTIFICATION_SYSTEM } from "./prompts";
import { TELEMETRY_TAG_VERIFICATION, TELEMETRY_TAG_PARSE, TELEMETRY_TAG_NOTIFICATION, MAX_PARSE_STEPS } from "./config";
import { runEvaluationPipeline } from "@/lib/tools/evaluation-pipeline";
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
  const { error } = await supabaseAdmin
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
  return JSON.parse(result.message);
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
  return JSON.parse(result.message);
}

const LISTING_MATERIAL_SELECT =
  "id, url, title, price, address, postcode, bedrooms, bathrooms, sqft, description, image_urls, floorplan_url, agent_name, agent_email, listed_date";

export async function deduplicateAndStore(
  listings: ListingOutput[],
): Promise<{ newIds: string[]; unchangedDuplicateCount: number }> {
  const newIds: string[] = [];
  let unchangedDuplicateCount = 0;

  for (const listing of listings) {
    const { data: existing } = await supabaseAdmin
      .from("listings")
      .select(LISTING_MATERIAL_SELECT)
      .eq("portal_id", listing.portal_id)
      .maybeSingle();

    if (existing) {
      const row = existing as ListingMaterialRow;
      if (listingMaterialDataUnchanged(row, listing)) {
        unchangedDuplicateCount++;
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from("listings")
        .update({
          ...listing,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updateError) {
        console.error("Update listing error:", updateError.message);
        continue;
      }

      newIds.push(String(row.id));
      continue;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("listings")
      .insert({
        ...listing,
        status: "pending_evaluation",
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique_violation on portal_id
      if (error.code === "23505") continue;
      console.error("Insert listing error:", error.message);
      continue;
    }

    if (inserted) newIds.push(String((inserted as { id: number | string }).id));
  }

  return { newIds, unchangedDuplicateCount };
}

export async function runEvaluationsAndNotify(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  // Send intro notification immediately (before evaluation starts)
  const intro = await runAgent({
    systemPrompt: INGEST_NOTIFICATION_SYSTEM,
    prompt: `${ids.length} new listing${ids.length > 1 ? "s" : ""} received. Checking match with your preferences...`,
    model: getIngestNotificationModel(),
    maxSteps: 1,
    telemetryTag: TELEMETRY_TAG_NOTIFICATION,
  });
  await sendMarkdown(intro.message);

  const batchId = crypto.randomUUID();
  let sequence = 0;

  // Process listings sequentially
  for (const id of ids) {
    try {
      const result = await runEvaluationPipeline(id);
      if (result) {
        await supabaseAdmin.from("pending_notifications").insert({
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
      }
    } catch (err) {
      console.error(`Evaluation failed for listing ${id}:`, err);
    }
  }

  // Consume scorecard notifications
  await consumePendingNotifications(batchId);

  // Summary after all scorecards sent
  if (ids.length > 1) {
    const summary = await runAgent({
      systemPrompt: INGEST_NOTIFICATION_SYSTEM,
      prompt: `You just finished evaluating ${ids.length} listings and sent scorecards. Write a short wrap-up message reminding the user to react (like) the ones they want to save.`,
      model: getIngestNotificationModel(),
      maxSteps: 1,
      telemetryTag: TELEMETRY_TAG_NOTIFICATION,
    });
    await sendMarkdown(summary.message);
  }
}
