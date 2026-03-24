import { createHash } from "crypto";
import { Output } from "ai";
import { runAgent } from "@/lib/core/agent";
import { reportError } from "@/lib/core/reporting";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getIngestParseModel, getEmailVerificationModel, getIngestNotificationModel } from "@/lib/config/agent-models";
import { ListingSchema, VerificationResultSchema } from "@/lib/schemas";
import type { VerificationResultOutput, ListingOutput } from "@/lib/schemas";
import { INGEST_PARSE_SYSTEM, EMAIL_VERIFICATION_SYSTEM, INGEST_NOTIFICATION_SYSTEM } from "./prompts";
import { TELEMETRY_TAG_VERIFICATION, TELEMETRY_TAG_PARSE, TELEMETRY_TAG_NOTIFICATION, MAX_PARSE_STEPS } from "./config";
import { runEvaluationPipeline } from "@/lib/tools/evaluation-pipeline";
import { sendMarkdown, sendWithButtons } from "@/lib/telegram";
import { consumePendingNotifications } from "@/lib/agents/notifications";
import { z } from "zod";

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

export type ValidatedListing = {
  listing: ListingOutput;
  flags: string[];
};

export type DeduplicateResult = {
  newIds: string[];
  updatedIds: string[];
  /** Maps listing ID → { changedFields, previousStatus } for listings that had a user-set status */
  changes: Map<string, { changedFields: string[]; previousStatus: string }>;
};

const MATERIAL_FIELDS = [
  "price", "title", "description", "address", "postcode",
  "bedrooms", "bathrooms", "sqft", "floorplan_url",
  "agent_name", "agent_email", "listed_date",
] as const;

const LISTING_SELECT_FIELDS = "id, status, price, title, description, address, postcode, bedrooms, bathrooms, sqft, image_urls, floorplan_url, agent_name, agent_email, listed_date";

function detectChanges(
  existing: Record<string, unknown>,
  incoming: ListingOutput,
): string[] {
  const changed: string[] = [];

  for (const field of MATERIAL_FIELDS) {
    const oldVal = existing[field] ?? null;
    const newVal = incoming[field] ?? null;
    if (String(oldVal) !== String(newVal)) changed.push(field);
  }

  // Compare image_urls by sorted content
  const oldImages = [...((existing.image_urls as string[]) || [])].sort().join(",");
  const newImages = [...(incoming.image_urls || [])].sort().join(",");
  if (oldImages !== newImages) changed.push("image_urls");

  return changed;
}

const USER_STATUSES = new Set(["saved", "dismissed", "viewing_requested"]);

export async function deduplicateAndStore(
  validatedListings: ValidatedListing[],
  rawEmail: string,
): Promise<DeduplicateResult> {
  const newIds: string[] = [];
  const updatedIds: string[] = [];
  const changes = new Map<string, { changedFields: string[]; previousStatus: string }>();

  for (const { listing, flags } of validatedListings) {
    // Check for existing by portal_id
    const { data: existing } = await getSupabaseAdmin()
      .from("listings")
      .select(LISTING_SELECT_FIELDS)
      .eq("portal_id", listing.portal_id)
      .single();

    if (existing) {
      const changedFields = detectChanges(existing as Record<string, unknown>, listing);
      if (changedFields.length === 0) continue; // Unchanged duplicate

      const existingId = (existing as { id: string }).id;
      const previousStatus = (existing as { status: string }).status;

      // Update listing data (not status yet)
      const { error: updateError } = await getSupabaseAdmin()
        .from("listings")
        .update({
          ...listing,
          validation_flags: flags,
          raw_email_html: rawEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingId);

      if (updateError) {
        await reportError(updateError, {
          source: "ingest/update-listing",
          telemetryTag: `portal_id:${listing.portal_id}`,
        });
        continue;
      }

      // Queue for re-evaluation
      await getSupabaseAdmin()
        .from("listings")
        .update({ status: "pending_evaluation", updated_at: new Date().toISOString() })
        .eq("id", existingId);

      updatedIds.push(existingId);
      if (USER_STATUSES.has(previousStatus)) {
        changes.set(existingId, { changedFields, previousStatus });
      }
      continue;
    }

    // New listing — insert
    const { data: inserted, error } = await getSupabaseAdmin()
      .from("listings")
      .insert({
        ...listing,
        validation_flags: flags,
        raw_email_html: rawEmail,
        status: "pending_evaluation",
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique_violation on portal_id (concurrent insert race)
      if (error.code === "23505") continue;
      await reportError(error, {
        source: "ingest/store-listing",
        telemetryTag: `portal_id:${listing.portal_id}`,
      });
      continue;
    }

    if (inserted) newIds.push((inserted as { id: string }).id);
  }

  return { newIds, updatedIds, changes };
}

export async function runEvaluationsAndNotify(
  ids: string[],
  opts?: { preClaimed?: boolean },
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
      // Transition to "evaluating" so the pipeline can mark it "evaluated"
      if (!opts?.preClaimed) {
        const { error: claimError } = await getSupabaseAdmin()
          .from("listings")
          .update({ status: "evaluating", updated_at: new Date().toISOString() })
          .eq("id", id)
          .in("status", ["pending_evaluation"]);

        if (claimError) {
          await reportError(claimError, {
            source: "ingest/claim-for-evaluation",
            telemetryTag: `listing:${id}`,
          });
          continue;
        }
      }

      const result = await runEvaluationPipeline(id);
      if (result) {
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
      }
    } catch (err) {
      await reportError(err, {
        source: "ingest/evaluation",
        telemetryTag: `listing:${id}`,
      });
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

function formatChangeSummary(changedFields: string[]): string {
  const labels: Record<string, string> = {
    price: "Price",
    title: "Title",
    description: "Description",
    address: "Address",
    postcode: "Postcode",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    sqft: "Square footage",
    floorplan_url: "Floorplan",
    agent_name: "Agent",
    agent_email: "Agent email",
    listed_date: "Listed date",
    image_urls: "Photos",
  };
  return changedFields.map((f) => labels[f] || f).join(", ");
}

export async function runReEvaluationsAndNotify(
  updatedIds: string[],
  changes: Map<string, { changedFields: string[]; previousStatus: string }>,
): Promise<void> {
  if (updatedIds.length === 0) return;

  const batchId = crypto.randomUUID();
  let sequence = 0;

  for (const id of updatedIds) {
    try {
      // Transition to "evaluating" so the pipeline can mark it "evaluated"
      const { error: claimError } = await getSupabaseAdmin()
        .from("listings")
        .update({ status: "evaluating", updated_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["pending_evaluation"]);

      if (claimError) {
        await reportError(claimError, {
          source: "ingest/claim-for-re-evaluation",
          telemetryTag: `listing:${id}`,
        });
        continue;
      }

      const result = await runEvaluationPipeline(id);
      if (!result) continue;

      const change = changes.get(id);
      if (change) {
        // Was saved/dismissed — send change notification with button to view scorecard
        const summary = formatChangeSummary(change.changedFields);
        const title = result.evaluation.property_summary?.split("\n")[0] || "Listing";
        const msg = `*Updated:* ${title}\n\nChanged: ${summary}\n\n_This listing was previously ${change.previousStatus}. It has been re\\-evaluated._`;
        await sendWithButtons(msg, [
          [{ text: "Show updated scorecard", callback_data: `why:${id}` }],
        ], "Markdown");
      } else {
        // Was in evaluated/pending state — send full scorecard as normal
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
      }
    } catch (err) {
      await reportError(err, {
        source: "ingest/re-evaluation",
        telemetryTag: `listing:${id}`,
      });
    }
  }

  // Consume any queued scorecards (for non-user-status listings)
  if (sequence > 0) {
    await consumePendingNotifications(batchId);
  }
}
