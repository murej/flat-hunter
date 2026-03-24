import { NextResponse } from "next/server";
import { ingestAgent } from "./index";
import { runAgent } from "@/lib/core/agent";
import { reportError } from "@/lib/core/reporting";
import { getIngestNotificationModel } from "@/lib/config/agent-models";
import { sendMarkdown } from "@/lib/telegram";
import { INGEST_NOTIFICATION_SYSTEM } from "./prompts";
import { TELEMETRY_TAG_NOTIFICATION } from "./config";

function checkAuth(request: Request): boolean {
  const secret = process.env.CLOUDMAILIN_SECRET;
  if (!secret) return true; // No auth configured

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const [scheme, credentials] = authHeader.split(" ");
  if (scheme !== "Basic" || !credentials) return false;

  try {
    const decoded = atob(credentials);
    const password = decoded.split(":").slice(1).join(":");
    return password === secret;
  } catch {
    return false;
  }
}

/** Fire-and-forget: trigger the evaluate cron in a separate function invocation. */
function triggerEvaluationCron(): void {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!appUrl) return;
  fetch(`${appUrl}/api/cron/evaluate`, {
    method: "GET",
    headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
  }).catch((err) => console.error("[cron-trigger]", err));
}

export async function handleIngestWebhook(
  request: Request,
): Promise<{ response: NextResponse; backgroundWork?: () => Promise<void> }> {
  if (!checkAuth(request)) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const contentType = request.headers.get("content-type") || "";
  let content: string;
  let rawEmail: string;
  let isRaw = false;

  if (contentType.includes("multipart/form-data")) {
    // CloudMailin raw format — RFC 5322
    const formData = await request.formData();
    const raw = formData.get("message");
    if (!raw) {
      return { response: NextResponse.json({ error: "No message in form data" }, { status: 400 }) };
    }
    content = raw.toString();
    rawEmail = content;
    isRaw = true;
  } else {
    // JSON format — build LLM context from parts
    const body = (await request.json()) as Record<string, unknown>;
    const html = (body.html as string) || "";
    const plain = (body.plain as string) || "";
    const subject = (body.subject as string) || "";
    content = JSON.stringify({ html, plain, subject });
    rawEmail = html || plain;
    isRaw = false;
  }

  const { newIds, updatedIds } = await ingestAgent(content, isRaw, rawEmail);
  const totalProcessed = newIds.length + updatedIds.length;

  return {
    response: NextResponse.json({ ok: true, newListings: newIds.length, updatedListings: updatedIds.length }),
    backgroundWork: totalProcessed > 0
      ? async () => {
          // Send intro notification (fast: 1 LLM call + Telegram send)
          if (newIds.length > 0) {
            try {
              const intro = await runAgent({
                systemPrompt: INGEST_NOTIFICATION_SYSTEM,
                prompt: `${newIds.length} new listing${newIds.length > 1 ? "s" : ""} received. Checking match with your preferences...`,
                model: getIngestNotificationModel(),
                maxSteps: 1,
                telemetryTag: TELEMETRY_TAG_NOTIFICATION,
              });
              await sendMarkdown(intro.message);
            } catch (err) {
              await reportError(err, { source: "ingest/intro-notification" });
            }
          }
          // Trigger evaluation in a separate function invocation (own 60s budget)
          triggerEvaluationCron();
        }
      : undefined,
  };
}
